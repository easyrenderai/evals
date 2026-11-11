// The product, as a customer's script sees it: the public REST API with an API key. Nothing here
// reaches into the app, its database or its models.

export type RenderView = {
  id: string;
  status: 'drafting' | 'preview_ready' | 'rendering' | 'ready' | 'failed';
  credits: number;
  renderCredits: number;
};

export class Client {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${this.apiKey}` },
    });
    if (!response.ok) {
      throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status} ${await response.text()}`);
    }
    return response;
  }

  async create(photo: Uint8Array, contentType: string, prompt: string): Promise<RenderView> {
    const form = new FormData();
    form.set('image', new File([photo as Uint8Array<ArrayBuffer>], 'photo.jpg', { type: contentType }));
    form.set('prompt', prompt);
    return (await this.call('/api/renders', { method: 'POST', body: form })).json();
  }

  /** Eval renders are not showcase material: keep them out of the public gallery. */
  async makePrivate(id: string): Promise<void> {
    await this.call(`/api/renders/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isPublic: false }),
    });
  }

  async get(id: string): Promise<RenderView> {
    return (await this.call(`/api/renders/${id}`)).json();
  }

  async build(id: string): Promise<RenderView> {
    return (await this.call(`/api/renders/${id}/render`, { method: 'POST' })).json();
  }

  async sheet(id: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.call(`/api/renders/${id}/preview`)).arrayBuffer());
  }

  async model(id: string): Promise<Uint8Array> {
    return new Uint8Array(await (await this.call(`/api/renders/${id}/model`)).arrayBuffer());
  }

  async balance(): Promise<number> {
    const body = (await (await this.call('/api/renders')).json()) as { balance: number };
    return body.balance;
  }
}
