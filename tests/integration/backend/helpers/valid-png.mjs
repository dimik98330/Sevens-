// Generated and decoded by the same pinned image library; no fake PNG headers.
import sharp from 'sharp';
export const VALID_PNG = await sharp({ create: {
  width: 2, height: 2, channels: 3, background: '#257a6c',
} }).png().toBuffer();
