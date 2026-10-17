import { randomUUID } from 'node:crypto';
import { PHOTO_BUCKET, db } from '../supabase';

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** An 800×600 "Sample photo" card: soft background, outline camera icon, two centred lines. */
export function placeholderSvg(title: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <rect width="800" height="600" fill="#f1eee8"/>
  <rect x="24" y="24" width="752" height="552" rx="20" fill="none" stroke="#d9d3c7" stroke-width="2" stroke-dasharray="10 8"/>
  <g transform="translate(340 170)" fill="none" stroke="#8a8172" stroke-width="6" stroke-linejoin="round" stroke-linecap="round">
    <path d="M10 30h26l12-18h24l12 18h26a8 8 0 0 1 8 8v62a8 8 0 0 1-8 8H10a8 8 0 0 1-8-8V38a8 8 0 0 1 8-8z"/>
    <circle cx="60" cy="68" r="22"/>
  </g>
  <text x="400" y="360" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#8a8172">Sample photo</text>
  <text x="400" y="406" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="600" fill="#4a4438">${escape(title)}</text>
</svg>`;
}

/** Uploads a placeholder SVG and returns its storage path (seed and demo only; users upload jpeg/png/webp). */
export async function uploadPlaceholder(homeId: string, title: string): Promise<string> {
  const path = `homes/${homeId}/${randomUUID()}.svg`;
  const { error } = await db()
    .storage.from(PHOTO_BUCKET)
    .upload(path, Buffer.from(placeholderSvg(title)), { contentType: 'image/svg+xml', upsert: false });
  if (error) throw new Error(`Storage error: ${error.message}`);
  return path;
}
