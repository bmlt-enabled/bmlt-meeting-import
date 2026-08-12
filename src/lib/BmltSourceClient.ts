/**
 * Reads meetings from any BMLT root server's public semantic interface.
 *
 * This is the *source* side of an import -- unauthenticated, read-only, and
 * pointed at some other server. The authenticated destination server is handled
 * by ServerApi. The semantic interface sends `Access-Control-Allow-Origin: *`,
 * so this works from the browser as well as from Node.
 */

export interface SemanticMeeting {
  id_bigint?: string;
  worldid_mixed?: string;
  service_body_bigint?: string;
  service_body_name?: string;
  weekday_tinyint?: string;
  venue_type?: string;
  start_time?: string;
  duration_time?: string;
  time_zone?: string;
  formats?: string;
  format_shared_id_list?: string;
  lang_enum?: string;
  longitude?: string;
  latitude?: string;
  published?: string;
  email_contact?: string;
  meeting_name?: string;
  location_text?: string;
  location_info?: string;
  location_street?: string;
  location_city_subsection?: string;
  location_neighborhood?: string;
  location_municipality?: string;
  location_sub_province?: string;
  location_province?: string;
  location_postal_code_1?: string;
  location_nation?: string;
  comments?: string;
  train_lines?: string;
  bus_lines?: string;
  contact_name_1?: string;
  contact_phone_1?: string;
  contact_email_1?: string;
  contact_name_2?: string;
  contact_phone_2?: string;
  contact_email_2?: string;
  phone_meeting_number?: string;
  virtual_meeting_link?: string;
  virtual_meeting_additional_info?: string;
  [key: string]: string | undefined;
}

export interface SemanticServiceBody {
  id: string;
  parent_id: string;
  name: string;
  description?: string;
  type: string;
  url?: string;
  helpline?: string;
  world_id?: string;
}

export interface SemanticFormat {
  id: string;
  key_string: string;
  name_string?: string;
  description_string?: string;
  world_id?: string;
  format_type_enum?: string;
  lang?: string;
}

export interface BmltSource {
  rootUrl: string;
  meetings: SemanticMeeting[];
  serviceBodies: SemanticServiceBody[];
  formats: SemanticFormat[];
}

export interface FetchSourceOptions {
  /** Restrict to these source service body ids. */
  serviceBodyIds?: string[];
  /** With serviceBodyIds, also include their children. */
  recursive?: boolean;
  /** Include unpublished meetings (they carry published = '0'). */
  includeUnpublished?: boolean;
  signal?: AbortSignal;
}

export class BmltSourceClient {
  /** Accepts a bare host, a root server URL, or one with client_interface already on it. */
  static normalizeRootUrl(rootUrl: string): string {
    let url = rootUrl.trim();

    if (!url) {
      throw new Error('A root server URL is required');
    }

    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    // Tolerate someone pasting a full semantic query
    url = url.split('?')[0];
    url = url.replace(/\/client_interface\/.*$/i, '');

    return url.endsWith('/') ? url : `${url}/`;
  }

  static buildUrl(rootUrl: string, params: Record<string, string>): string {
    const url = new URL('client_interface/json/', this.normalizeRootUrl(rootUrl));
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
  }

  private static async get<T>(rootUrl: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
    const url = this.buildUrl(rootUrl, params);

    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      throw new Error(`Could not reach ${url}. Check the URL and that the server allows cross-origin requests.`, { cause: error });
    }

    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}`);
    }

    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new Error(`${url} did not return JSON. Is this a BMLT root server?`, { cause: error });
    }
  }

  static async getServerInfo(rootUrl: string, signal?: AbortSignal): Promise<Record<string, string>[]> {
    return this.get<Record<string, string>[]>(rootUrl, { switcher: 'GetServerInfo' }, signal);
  }

  static async getServiceBodies(rootUrl: string, signal?: AbortSignal): Promise<SemanticServiceBody[]> {
    return this.get<SemanticServiceBody[]>(rootUrl, { switcher: 'GetServiceBodies' }, signal);
  }

  static async getFormats(rootUrl: string, signal?: AbortSignal): Promise<SemanticFormat[]> {
    return this.get<SemanticFormat[]>(rootUrl, { switcher: 'GetFormats' }, signal);
  }

  static async getMeetings(rootUrl: string, options: FetchSourceOptions = {}): Promise<SemanticMeeting[]> {
    const params: Record<string, string> = { switcher: 'GetSearchResults' };

    if (options.serviceBodyIds?.length) {
      params.services = options.serviceBodyIds.join(',');
      if (options.recursive) {
        params.recursive = '1';
      }
    }

    if (options.includeUnpublished) {
      params.advanced_published = '0';
    }

    const meetings = await this.get<SemanticMeeting[]>(rootUrl, params, options.signal);

    // The semantic interface answers an unusable filter with [] rather than an error
    return Array.isArray(meetings) ? meetings : [];
  }

  /** Everything an import needs, in one round trip. */
  static async fetchSource(rootUrl: string, options: FetchSourceOptions = {}): Promise<BmltSource> {
    const normalized = this.normalizeRootUrl(rootUrl);

    const [meetings, serviceBodies, formats] = await Promise.all([
      this.getMeetings(normalized, options),
      this.getServiceBodies(normalized, options.signal),
      this.getFormats(normalized, options.signal)
    ]);

    return { rootUrl: normalized, meetings, serviceBodies, formats };
  }
}
