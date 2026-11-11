import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../../../lib/errors.ts";
import config from "../../../../lib/config.ts";

/** Driver licence and RC uploads: photo or PDF, max 8 MB each, content checked against the declared type. */

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES: Record<string, { ext: string; magic: number[] }> = {
    "image/jpeg": { ext: ".jpg", magic: [0xff, 0xd8, 0xff] },
    "image/png": { ext: ".png", magic: [0x89, 0x50, 0x4e, 0x47] },
    "application/pdf": { ext: ".pdf", magic: [0x25, 0x50, 0x44, 0x46] }
};

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 2, fields: 20 },
    fileFilter(req, file, callback) {
        if (!ALLOWED_TYPES[file.mimetype])
            return callback(new AppError("VALIDATION_FAILED", "Documents must be photos (JPG/PNG) or PDF files."));
        callback(null, true);
    }
}).fields([
    { name: "licenseDoc", maxCount: 1 },
    { name: "rcDoc", maxCount: 1 }
]);

export function parseUpload(req: Request, res: Response, next: NextFunction): void {
    upload(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
            const message = err.code === "LIMIT_FILE_SIZE" ? "Each document must be 8 MB or smaller." : "Upload failed. Please try again.";
            return next(new AppError("VALIDATION_FAILED", message));
        }
        next(err);
    });
}

/** Check the file's real content matches its declared type, then store it with a random name. */
export function saveDocument(file: Express.Multer.File | undefined): string | null {
    if (!file) return null;
    const type = ALLOWED_TYPES[file.mimetype]!;
    if (!type.magic.every((byte, index) => file.buffer[index] === byte)) {
        throw new AppError("VALIDATION_FAILED", "That file doesn't look like a valid photo or PDF.");
    }
    fs.mkdirSync(config.uploadDir, { recursive: true });
    const name = `${crypto.randomUUID()}${type.ext}`;
    fs.writeFileSync(path.join(config.uploadDir, name), file.buffer);
    return name;
}
