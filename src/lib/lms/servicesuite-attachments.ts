// ─────────────────────────────────────────────────────────────────────────────
// THE BORROWER'S PAPERWORK, READ FROM THE LENDER'S OWN BOOK.
//
// Micromart's officers photograph a customer's business, their home, the thing
// standing as security, and the front and back of the national ID that proves
// who they are. Those photographs are the field evidence behind every limit on
// this book — and until now the console could not see one of them, while the
// lender's own Borrower 360 has shown them for years.
//
// ── MODELLED ON GetBorrowerAttachments, NOT CALLED ──────────────────────────
// Their procedure returns two result sets:
//
//   1. the KYC trio off the Borrowers row — borrowerPhoto, idFrontPhoto,
//      idBackPhoto — each a Google Drive file id.
//   2. every row of BorrowerAttachments for that borrower: name, description,
//      the Drive id in `path`, the address it was taken at, and FileType.
//
// Both are reproduced here for the same two reasons the statement reader gives:
// the procedure derives the entity from the borrower row rather than asserting
// it, and this integration is entity-scoped by construction — 3002 and 3005 hold
// DIFFERENT PEOPLE, and handing an officer the wrong person's ID photograph is a
// data-protection incident, not a display bug. So the entity is checked HERE.
//
// ── FileType IS USUALLY NULL ────────────────────────────────────────────────
// Their own view reads it as ISNULL(FileType,'img'), and on this book it is null
// far more often than not — the column was added after most of the rows. We keep
// their default, because every attachment we have looked at IS a photograph, and
// a PDF rendered as a broken image is a smaller failure than a photograph
// rendered as a file icon nobody clicks.
//
// ── THE FILES THEMSELVES ────────────────────────────────────────────────────
// They live in Google Drive with link-visible sharing, and the row carries only
// the file id — the same arrangement the borrower PHOTO already uses, which is
// why `drivePhotoUrl` exists and is reused rather than re-derived. Nothing is
// proxied through us: these are the lender's files, in the lender's Drive, under
// the lender's sharing rules.
// ─────────────────────────────────────────────────────────────────────────────
import { runReadOnlyQuery, mssql, type QueryParam } from "@/lib/enterprise/mssql";
import { type OrgDef } from "@/lib/enterprise/connections";

/** Where in the file this came from — identity is gated harder than field work. */
export type AttachmentGroup = "identity" | "field";

export type LiveAttachment = {
  /** Stable within a borrower; used as a React key and as a lightbox target. */
  id: string;
  label: string;
  description: string | null;
  group: AttachmentGroup;
  kind: "image" | "file";
  /** The Google Drive file id, as the lender stores it. */
  fileId: string;
  /** Grid size — small enough that twenty of them do not stall the page. */
  thumbUrl: string;
  /** Lightbox size. The same endpoint, asked for more pixels. */
  viewUrl: string;
  /** Drive's own download route. Opens a save dialog rather than a viewer. */
  downloadUrl: string;
  capturedAt: string | null;
  /** Where the officer was standing. Present on newer rows only. */
  where: string | null;
  lat: number | null;
  lng: number | null;
};

/** One Drive file id, at a given width. See servicesuite.ts drivePhotoUrl. */
function driveThumb(fileId: string, width: number): string {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${width}`;
}

/** Drive's save-to-disk route for a link-visible file. */
function driveDownload(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
}

function attachment(
  id: string,
  fileId: string,
  label: string,
  group: AttachmentGroup,
  extra: Partial<LiveAttachment> = {},
): LiveAttachment {
  return {
    id,
    label,
    description: null,
    group,
    kind: "image",
    fileId,
    thumbUrl: driveThumb(fileId, 640),
    viewUrl: driveThumb(fileId, 1600),
    downloadUrl: driveDownload(fileId),
    capturedAt: null,
    where: null,
    lat: null,
    lng: null,
    ...extra,
  };
}

/**
 * Every attachment the lender holds for one customer, identity first.
 *
 * Returns [] rather than throwing when the borrower is not in this entity: the
 * caller is a page that must still render everything else it knows, and an
 * absent gallery is the honest rendering of "nothing on file here".
 */
export async function getBorrowerAttachmentsLive(
  org: OrgDef,
  entityId: number,
  borrowerId: number,
): Promise<LiveAttachment[]> {
  const params: QueryParam[] = [
    { name: "borrowerId", type: mssql.Int, value: borrowerId },
    { name: "entityId", type: mssql.Int, value: entityId },
  ];

  const [who, extras] = await Promise.all([
    runReadOnlyQuery(
      org,
      `SELECT TOP 1 b.borrowerPhoto, b.idFrontPhoto, b.idBackPhoto
       FROM Borrowers b WHERE b.ID = @borrowerId AND b.EntityId = @entityId`,
      params,
      { timeoutMs: 30000, maxRows: 1 },
    ),
    // NOT filtered by entity. BorrowerAttachments carries no EntityId at all, and
    // the parent row above has already established which book we are standing in
    // — the same rule the schedule reader follows, and for the same reason.
    runReadOnlyQuery(
      org,
      `SELECT a.id, a.attachmentId, a.AttachmentName, a.AttachmentDescription, a.path,
              a.DateCreated, a.Latitude, a.Longitude, a.AttachmentAddress,
              ISNULL(a.FileType, 'img') AS FileType,
              f.AttachmentName AS TypeName
       FROM BorrowerAttachments a
       LEFT JOIN AttachmentFiles f ON f.ID = a.attachmentId
       WHERE a.borrowerId = @borrowerId
       ORDER BY a.DateCreated DESC, a.id DESC`,
      params,
      { timeoutMs: 30000, maxRows: 200 },
    ),
  ]);

  if (who.rows.length === 0) return [];

  const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
  const numOrNull = (v: unknown): number | null => {
    if (v == null) return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };

  const out: LiveAttachment[] = [];
  const b = who.rows[0];

  // Identity first, always, and in the order a human checks them: the face, then
  // the document that names it, then its reverse.
  const trio: [unknown, string, string][] = [
    [b.borrowerPhoto, "portrait", "Borrower photo"],
    [b.idFrontPhoto, "id-front", "National ID — front"],
    [b.idBackPhoto, "id-back", "National ID — back"],
  ];
  for (const [raw, key, label] of trio) {
    const fileId = str(raw);
    if (fileId) out.push(attachment(key, fileId, label, "identity"));
  }

  for (const r of extras.rows) {
    const fileId = str(r.path);
    if (!fileId) continue;
    const label = str(r.AttachmentName) ?? str(r.TypeName) ?? "Attachment";
    out.push(
      attachment(`a-${r.id}`, fileId, label, "field", {
        description: str(r.AttachmentDescription),
        kind: String(r.FileType ?? "img").toLowerCase() === "img" ? "image" : "file",
        capturedAt: r.DateCreated ? new Date(r.DateCreated as string).toISOString() : null,
        where: str(r.AttachmentAddress),
        lat: numOrNull(r.Latitude),
        lng: numOrNull(r.Longitude),
      }),
    );
  }

  return out;
}
