import type { ServiceBodyCreate, ServiceBody, User } from 'bmlt-server-client';
import RootServerApi from './ServerApi';
import type { ServiceBodyMatch } from './BmltSourceMapper';
import { BmltSourceMapper } from './BmltSourceMapper';

const VALID_SERVICE_BODY_TYPES = new Set(['GR', 'CO', 'GS', 'LS', 'AS', 'MA', 'RS', 'ZF', 'WS']);

export interface ServiceBodyCreationResult {
  serviceBody: ServiceBody;
  user: User;
  isNewServiceBody: boolean;
}

export interface ServiceBodyCreationStats {
  totalProcessed: number;
  servicesBodiesCreated: number;
  errors: string[];
  warnings: string[];
  results: ServiceBodyCreationResult[];
}

export class ServiceBodyCreator {
  static async createMissingServiceBodies(
    missingAreas: { worldId: string; name: string }[],
    onProgress?: (current: number, total: number, areaName: string) => void
  ): Promise<ServiceBodyCreationStats> {
    const stats: ServiceBodyCreationStats = {
      totalProcessed: 0,
      servicesBodiesCreated: 0,
      errors: [],
      warnings: [],
      results: []
    };

    for (let i = 0; i < missingAreas.length; i++) {
      const area = missingAreas[i];
      stats.totalProcessed++;

      onProgress?.(i + 1, missingAreas.length, area.name);

      try {
        const result = await this.createServiceBodyWithUser(area.worldId, area.name);
        stats.results.push(result);

        if (result.isNewServiceBody) {
          stats.servicesBodiesCreated++;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        stats.errors.push(`Failed to create service body for ${area.name} (${area.worldId}): ${errorMessage}`);
      }
    }

    return stats;
  }

  private static async createServiceBodyWithUser(worldId: string, areaName: string): Promise<ServiceBodyCreationResult> {
    // Check if service body already exists
    const existingServiceBodies = await RootServerApi.getServiceBodies();
    const existingServiceBody = existingServiceBodies.find((sb) => sb.worldId && sb.worldId.toUpperCase() === worldId.toUpperCase());

    console.log(`Processing service body: ${areaName} (${worldId})`);

    if (existingServiceBody) {
      // Service body already exists, try to get the admin user
      let principalUser: User | null = null;
      try {
        principalUser = await RootServerApi.getUser(existingServiceBody.adminUserId);
      } catch (error) {
        console.log(error);
      }

      if (principalUser) {
        return {
          serviceBody: existingServiceBody,
          user: principalUser,
          isNewServiceBody: false
        };
      }
    }

    // Get the current user from the API credentials to use as admin
    let adminUser: User;
    try {
      const currentUserId = RootServerApi.token?.userId;
      if (!currentUserId) {
        throw new Error('No current user found - please ensure you are logged in');
      }

      adminUser = await RootServerApi.getUser(currentUserId);
      console.log(`Using current user '${adminUser.username}' as admin for service body '${areaName}'`);
    } catch (error) {
      throw new Error(`Failed to get current user for service body admin: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
    }

    // Create the service body if it doesn't exist
    if (existingServiceBody) {
      return {
        serviceBody: existingServiceBody,
        user: adminUser,
        isNewServiceBody: false
      };
    }

    const serviceBodyType = this.determineServiceBodyType(worldId);

    const serviceBodyCreate: ServiceBodyCreate = {
      parentId: null, // Top level service body
      name: areaName,
      description: areaName,
      type: serviceBodyType,
      adminUserId: adminUser.id,
      assignedUserIds: [adminUser.id],
      worldId: worldId,
      email: '',
      helpline: '',
      url: ''
    };

    try {
      const serviceBody = await RootServerApi.createServiceBody(serviceBodyCreate);

      return {
        serviceBody: serviceBody,
        user: adminUser,
        isNewServiceBody: true
      };
    } catch (error) {
      throw new Error(`Failed to create service body: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
    }
  }

  private static determineServiceBodyType(worldId: string): string {
    // Based on the PHP logic and valid BMLT service body types:
    // Valid BMLT types: GR (Group), CO (Coop), GS (GSU), LS (LSU),
    //                   AS (Area), MA (Metro), RS (Region), ZF (Zone), WS (World)
    // AR prefix = AS (Area), otherwise RS (Region)
    if (worldId.toUpperCase().startsWith('AR')) {
      return 'AS'; // Area Service Committee
    } else {
      return 'RS'; // Regional Service Committee
    }
  }

  /**
   * Creates the service bodies a BMLT-to-BMLT import needs, parents first, so
   * the source hierarchy is rebuilt on the destination. Returns a map from
   * source service body id to destination id covering matched *and* newly
   * created bodies.
   */
  static async resolveSourceServiceBodies(
    matches: ServiceBodyMatch[],
    onProgress?: (current: number, total: number, name: string) => void
  ): Promise<{ idMap: Map<string, number>; created: number; errors: string[]; warnings: string[] }> {
    const idMap = new Map<string, number>();
    const errors: string[] = [];
    const warnings: string[] = [];
    let created = 0;

    matches.forEach((match) => {
      if (match.destination) {
        idMap.set(String(match.source.id), match.destination.id);
      }
    });

    const toCreate = BmltSourceMapper.orderForCreation(matches);
    if (toCreate.length === 0) {
      return { idMap, created, errors, warnings };
    }

    let adminUser: User;
    try {
      const currentUserId = RootServerApi.token?.userId;
      if (!currentUserId) {
        throw new Error('No current user found - please ensure you are logged in');
      }
      adminUser = await RootServerApi.getUser(currentUserId);
    } catch (error) {
      errors.push(`Failed to get current user for service body admin: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return { idMap, created, errors, warnings };
    }

    for (let i = 0; i < toCreate.length; i++) {
      const match = toCreate[i];
      const sourceId = String(match.source.id);
      const name = match.source.name?.trim() || `Service body ${sourceId}`;

      onProgress?.(i + 1, toCreate.length, name);

      // Only reachable if the parent itself failed to be created
      const sourceParentId = match.source.parent_id?.trim();
      const parentId = sourceParentId && sourceParentId !== '0' ? (idMap.get(sourceParentId) ?? null) : null;
      if (sourceParentId && sourceParentId !== '0' && parentId === null) {
        warnings.push(`Service body '${name}' was created at the top level because its parent could not be resolved`);
      }

      const type = match.source.type?.trim().toUpperCase() ?? '';

      try {
        const serviceBody = await RootServerApi.createServiceBody({
          parentId,
          name,
          description: match.source.description?.trim() || name,
          type: VALID_SERVICE_BODY_TYPES.has(type) ? type : 'AS',
          adminUserId: adminUser.id,
          assignedUserIds: [adminUser.id],
          worldId: match.source.world_id?.trim() || '',
          email: '',
          helpline: match.source.helpline?.trim() || '',
          url: match.source.url?.trim() || ''
        });

        idMap.set(sourceId, serviceBody.id);
        created++;
      } catch (error) {
        errors.push(`Failed to create service body '${name}': ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return { idMap, created, errors, warnings };
  }

  static extractUniqueAreas(nawsRows: { parentname?: string; arearegion?: string; delete?: string }[]): { worldId: string; name: string }[] {
    const uniqueAreas = new Map<string, string>();

    nawsRows.forEach((row) => {
      if (row.delete?.toUpperCase() === 'D') return; // Skip deleted meetings

      const worldId = row.arearegion?.trim();
      const name = row.parentname?.trim();

      if (worldId && name) {
        const normalizedWorldId = worldId.toUpperCase();
        if (!uniqueAreas.has(normalizedWorldId)) {
          uniqueAreas.set(normalizedWorldId, name);
        }
      }
    });

    return Array.from(uniqueAreas.entries()).map(([worldId, name]) => ({
      worldId,
      name
    }));
  }

  static async findMissingServiceBodies(requiredAreas: { worldId: string; name: string }[]): Promise<{ worldId: string; name: string }[]> {
    const existingServiceBodies = await RootServerApi.getServiceBodies();
    const existingWorldIds = new Set(existingServiceBodies.filter((sb) => sb.worldId).map((sb) => sb.worldId!.toUpperCase()));

    return requiredAreas.filter((area) => !existingWorldIds.has(area.worldId.toUpperCase()));
  }
}
