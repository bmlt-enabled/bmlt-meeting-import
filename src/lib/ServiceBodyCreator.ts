import type { ServiceBodyCreate, ServiceBody, User } from 'bmlt-server-client';
import RootServerApi from './ServerApi';

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
      throw new Error(`Failed to get current user for service body admin: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
      throw new Error(`Failed to create service body: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
