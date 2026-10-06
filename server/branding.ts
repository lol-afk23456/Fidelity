import { Router, type RequestHandler } from 'express';
import sharp from 'sharp';
import { z } from 'zod';
import { roles } from './auth.js';
import { type DB, all, one, run, atomic, now, sequence, enqueue, audit } from './db.js';
import { AppError, baseUrl, required } from './domain.js';

const MAX_BYTES = 512 * 1024;
const MAX_PIXELS = 2_000_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const logoError = (message: string) => new AppError(400, message, 'INVALID_LOGO');

function inputFormat(bytes: Buffer): 'png' | 'jpeg' | 'webp' | undefined {
  if (bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return undefined;
}

/**
 * Decode only uploaded bytes, never paths/URLs. Re-encode pixels onto a 320×100
 * transparent canvas with no EXIF/XMP/ICC payloads. This is the 2× Wallet asset;
 * Apple builds a separate 160×50 base version rather than mislabelling 2× pixels.
 */
export async function sanitizeLogo(dataUrl: string): Promise<Buffer> {
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(MAX_BYTES / 3) * 4 + 64) {
    throw logoError('Il logo non può superare 512 KB.');
  }
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2]!.length % 4 !== 0) throw logoError('Carica un file PNG, JPEG o WebP valido.');
  const bytes = Buffer.from(match[2]!, 'base64');
  if (bytes.length > MAX_BYTES) throw logoError('Il logo non può superare 512 KB.');
  if (bytes.toString('base64') !== match[2] || inputFormat(bytes) !== match[1]) {
    throw logoError('Il contenuto del logo non corrisponde al formato dichiarato.');
  }
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'warning', animated: false });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) {
      throw logoError('Il logo non può superare 2 milioni di pixel.');
    }
    if (metadata.format !== match[1] || (metadata.pages ?? 1) > 1) {
      throw logoError('Usa un’immagine statica PNG, JPEG o WebP.');
    }
    const fitted = await image.rotate().toColourspace('srgb').ensureAlpha()
      .resize({ width: 320, height: 100, fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9 }).toBuffer();
    return await sharp({ create: { width: 320, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: fitted, gravity: 'centre' }]).png({ compressionLevel: 9 }).toBuffer();
  } catch (error) {
    if (error instanceof AppError) throw error;
    // Decoder errors may include untrusted metadata. Never return their original contents.
    throw logoError('Immagine non valida o troppo grande: massimo 512 KB e 2 milioni di pixel.');
  }
}

export function programLogo(db: DB, programId: string): Buffer | undefined {
  const row = one(db, 'SELECT png FROM branding WHERE program_id=?', programId);
  return row ? Buffer.from(row.png as Uint8Array) : undefined;
}

/** Mount after auth(db) and scope(db); Origin and CSRF are enforced by those middleware. */
export function brandingRoutes(db: DB): Router {
  const router = Router();
  router.post('/programs/:id/logo', roles('agency', 'owner'), async (req, res) => {
    if (!req.user || !req.tenantId) throw new AppError(401, 'Accedi per continuare', 'UNAUTHENTICATED');
    const programId = String(req.params.id);
    required(one(db, 'SELECT id FROM programs WHERE id=? AND tenant_id=?', programId, req.tenantId));
    const input = z.object({ dataUrl: z.string().max(700_000) }).strict().parse(req.body);
    const png = await sanitizeLogo(input.dataUrl);
    const updatedAt = now();
    atomic(db, () => {
      // Check ownership again after decoding, before persisting or enqueueing any work.
      required(one(db, 'SELECT id FROM programs WHERE id=? AND tenant_id=?', programId, req.tenantId));
      run(db, 'INSERT INTO branding(program_id,tenant_id,png,updated_at) VALUES(?,?,?,?) ON CONFLICT(program_id) DO UPDATE SET png=excluded.png,updated_at=excluded.updated_at',
        programId, req.tenantId, png, updatedAt);
      for (const member of all(db, "SELECT id FROM members WHERE program_id=? AND tenant_id=? AND status='active'", programId, req.tenantId)) {
        run(db, 'UPDATE members SET updated_at=?,update_seq=? WHERE id=?', updatedAt, sequence(db), member.id);
        enqueue(db, req.tenantId!, member.id);
      }
      audit(db, req.tenantId!, req.user!.id, 'program.logo_updated', programId);
    });
    res.json({ logoUrl: `${baseUrl()}/api/branding/${encodeURIComponent(programId)}.png?v=${encodeURIComponent(updatedAt)}` });
  });
  return router;
}

/** Public merchant branding only. Must be mounted before the private API router. */
export function publicLogoHandler(db: DB): RequestHandler {
  return (req, res) => {
    const programId = String(req.params.programId);
    const row = required(one(db, 'SELECT b.png FROM branding b JOIN programs p ON p.id=b.program_id JOIN tenants t ON t.id=b.tenant_id WHERE b.program_id=? AND t.active=1', programId), 'Logo non trovato');
    res.set({ 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=300' })
      .send(Buffer.from(row.png as Uint8Array));
  };
}
