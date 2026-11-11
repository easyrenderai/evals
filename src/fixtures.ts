import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Photo } from './types.ts';

export async function loadManifest(root: string): Promise<Photo[]> {
  const file = JSON.parse(await readFile(join(root, 'fixtures/manifest.json'), 'utf8')) as {
    photos: Photo[];
  };
  return file.photos;
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The photo's bytes, from fixtures/photos/<slug>.jpg when present, else from its source URL. Always verified. */
export async function photoBytes(root: string, photo: Photo): Promise<Uint8Array> {
  const local = join(root, 'fixtures/photos', `${photo.slug}.jpg`);
  const bytes = existsSync(local)
    ? new Uint8Array(await readFile(local))
    : await fetch(photo.source_url).then(async (response) => {
        if (!response.ok) throw new Error(`${photo.source_url} -> ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      });
  if (sha256(bytes) !== photo.sha256) {
    throw new Error(`${photo.slug}: photo does not match the sha256 in fixtures/manifest.json`);
  }
  return bytes;
}
