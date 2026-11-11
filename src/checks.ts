import sharp from 'sharp';

// The two criteria decided by code. They run on what a customer gets: the paid angle sheet
// (full resolution once the 3D build has been paid for) and the downloaded GLB.
//
// The view check follows the harness guardrail (64px greyscale copies of the nine cells, mean
// absolute difference) but is stricter, because the guardrail only has to refuse a broken sheet
// while this one scores a good one: no cell may be empty and no two turnaround views may repeat.

export const VIEW_DISTANCE = 0.015; // same threshold as the harness guardrail
const CELLS = 9;
const TURNAROUND = 8; // the ninth cell is the top-down view
const INSET = 8;
const SIGNATURE = 64;
const OBJECT_MIN_FRACTION = 0.005;
const BACKGROUND_FLOOR = 235;

export async function cutCells(sheet: Uint8Array): Promise<Buffer[]> {
  const { width = 0, height = 0 } = await sharp(sheet).metadata();
  const cell = Math.floor(Math.min(width, height) / 3);
  if (cell <= INSET * 2) throw new Error(`sheet too small to cut: ${width}x${height}`);
  return Promise.all(
    Array.from({ length: CELLS }, (_, index) =>
      sharp(sheet)
        .extract({
          left: (index % 3) * cell + INSET,
          top: Math.floor(index / 3) * cell + INSET,
          width: cell - INSET * 2,
          height: cell - INSET * 2,
        })
        .png()
        .toBuffer(),
    ),
  );
}

export type ViewsResult = {
  passed: boolean;
  emptyCells: number;
  repeatedViews: number;
  minDistance: number;
};

export async function checkViews(sheet: Uint8Array): Promise<ViewsResult> {
  const cells = await cutCells(sheet);
  let emptyCells = 0;
  const signatures: Uint8Array[] = [];
  for (const cell of cells) {
    const { data, info } = await sharp(cell)
      .resize(SIGNATURE, SIGNATURE, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let object = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const min = Math.min(data[i] as number, data[i + 1] as number, data[i + 2] as number);
      if (min < BACKGROUND_FLOOR) object++;
    }
    if (object / (info.width * info.height) < OBJECT_MIN_FRACTION) emptyCells++;
    signatures.push(
      new Uint8Array(
        await sharp(cell).greyscale().resize(SIGNATURE, SIGNATURE, { fit: 'fill' }).raw().toBuffer(),
      ),
    );
  }

  const ring = signatures.slice(0, TURNAROUND);
  const distance = (a: Uint8Array, b: Uint8Array) =>
    a.reduce((sum, value, i) => sum + Math.abs(value - (b[i] as number)), 0) / a.length / 255;
  let minDistance = Number.POSITIVE_INFINITY;
  const repeated = new Set<number>();
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 1; j < ring.length; j++) {
      const d = distance(ring[i] as Uint8Array, ring[j] as Uint8Array);
      minDistance = Math.min(minDistance, d);
      if (d < VIEW_DISTANCE) {
        repeated.add(i);
        repeated.add(j);
      }
    }
  }
  return {
    passed: emptyCells === 0 && repeated.size === 0,
    emptyCells,
    repeatedViews: repeated.size,
    minDistance: Number(minDistance.toFixed(4)),
  };
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a; // "JSON"
const MIN_GLB_BYTES = 20_000;

export type FileResult = { passed: boolean; reason: string };

/** A complete binary glTF 2: right header, declared length, a parsable JSON chunk with a mesh. */
export function checkGlb(bytes: Uint8Array): FileResult {
  const fail = (reason: string): FileResult => ({ passed: false, reason });
  if (bytes.byteLength < MIN_GLB_BYTES) return fail('file is empty or too small');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) return fail('not a glTF binary');
  if (view.getUint32(4, true) !== 2) return fail('not glTF version 2');
  if (view.getUint32(8, true) !== bytes.byteLength) return fail('declared length does not match');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== CHUNK_JSON) return fail('first chunk is not JSON');
  if (20 + jsonLength > bytes.byteLength) return fail('JSON chunk runs past the end');
  let gltf: { meshes?: unknown[] };
  try {
    gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  } catch {
    return fail('JSON chunk does not parse');
  }
  if (!Array.isArray(gltf.meshes) || gltf.meshes.length === 0) return fail('no mesh in the file');
  return { passed: true, reason: 'ok' };
}
