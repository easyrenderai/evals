import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { checkGlb, checkViews } from './checks.ts';

const CELL = 200;

/** A 3x3 sheet; `shape(i)` returns an SVG body for cell i, or null for an empty cell. */
async function sheet(shape: (index: number) => string | null): Promise<Uint8Array> {
  const cells = await Promise.all(
    Array.from({ length: 9 }, async (_, i) => {
      const body = shape(i);
      return {
        input: await sharp(
          Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}"><rect width="100%" height="100%" fill="white"/>${body ?? ''}</svg>`,
          ),
        )
          .png()
          .toBuffer(),
        left: (i % 3) * CELL,
        top: Math.floor(i / 3) * CELL,
      };
    }),
  );
  return new Uint8Array(
    await sharp({ create: { width: CELL * 3, height: CELL * 3, channels: 3, background: 'white' } })
      .composite(cells)
      .png()
      .toBuffer(),
  );
}

// A different block in every cell: its width, height and position all change with the index.
const distinct = (i: number) =>
  `<rect x="${20 + i * 9}" y="${30 + ((i * 17) % 60)}" width="${30 + i * 11}" height="${40 + ((i * 23) % 70)}" fill="#222"/>`;

describe('checkViews', () => {
  test('passes a sheet whose cells all differ', async () => {
    const result = await checkViews(await sheet(distinct));
    expect(result).toMatchObject({ passed: true, emptyCells: 0, repeatedViews: 0 });
    expect(result.minDistance).toBeGreaterThan(0.015);
  });

  test('fails a sheet that repeats one view in every cell', async () => {
    const result = await checkViews(await sheet(() => distinct(3)));
    expect(result.passed).toBe(false);
    expect(result.repeatedViews).toBe(8);
  });

  test('fails a sheet with an empty cell, and counts it', async () => {
    const result = await checkViews(await sheet((i) => (i === 4 ? null : distinct(i))));
    expect(result.passed).toBe(false);
    expect(result.emptyCells).toBe(1);
  });

  test('counts a repeated pair as two repeated views, not the whole sheet', async () => {
    const result = await checkViews(await sheet((i) => distinct(i === 1 ? 0 : i)));
    expect(result.passed).toBe(false);
    expect(result.repeatedViews).toBe(2);
  });
});

function glb(json: object, padTo = 25_000, version = 2): Uint8Array {
  const text = JSON.stringify(json);
  const jsonBytes = new TextEncoder().encode(text.padEnd(Math.ceil(text.length / 4) * 4, ' '));
  const total = Math.max(padTo, 20 + jsonBytes.length);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, version, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  return out;
}

describe('checkGlb', () => {
  test('accepts a complete glTF 2 binary with a mesh', () => {
    expect(checkGlb(glb({ asset: { version: '2.0' }, meshes: [{}] }))).toEqual({
      passed: true,
      reason: 'ok',
    });
  });

  test('rejects a file with no mesh', () => {
    expect(checkGlb(glb({ asset: { version: '2.0' }, meshes: [] })).reason).toBe('no mesh in the file');
  });

  test('rejects a tiny file, a wrong version and a truncated download', () => {
    expect(checkGlb(new Uint8Array(100)).passed).toBe(false);
    expect(checkGlb(glb({ meshes: [{}] }, 25_000, 1)).reason).toBe('not glTF version 2');
    expect(checkGlb(glb({ meshes: [{}] }).subarray(0, 24_000)).reason).toBe(
      'declared length does not match',
    );
  });
});
