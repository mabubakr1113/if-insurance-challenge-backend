import { homeOrPartnerAccess } from '@/lib/auth';
import { ApiError, route } from '@/lib/http';
import { uploadPhoto } from '@/lib/services/photos';

export const POST = route(
  { access: (actor, p, req) => homeOrPartnerAccess(actor, p.homeId, 'H', req, true) },
  async ({ access, req }) => {
    const form = await req.formData().catch(() => {
      throw new ApiError(400, 'invalid_request', 'Send the photo as multipart/form-data');
    });
    const uploader =
      access.kind === 'member'
        ? { label: access.me.name, memberId: access.me.id }
        : { label: access.partner.partner.name, memberId: null };
    return uploadPhoto(access.home, uploader, form);
  },
);

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
