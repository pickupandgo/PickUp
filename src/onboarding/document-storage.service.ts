import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';

export interface UploadDescriptor {
  readonly key: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly documentId: string;
}
export interface StoredDocumentDescriptor extends UploadDescriptor {
  readonly checksumSha256: string;
  readonly storageVersionId: string;
  readonly storageETag: string;
}
export interface VerifiedUpload {
  readonly checksumSha256: string;
  readonly storageVersionId: string;
  readonly storageETag: string;
}
export type ScanResult = 'CLEAN' | 'INFECTED';

@Injectable()
export class DocumentStorageService {
  private readonly client: S3Client | null;
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const storage = config.documents.storage;
    this.client = storage
      ? new S3Client({
          endpoint: storage.endpoint,
          region: storage.region,
          forcePathStyle: storage.forcePathStyle,
          credentials: {
            accessKeyId: storage.accessKeyId,
            secretAccessKey: storage.secretAccessKey,
          },
        })
      : null;
  }
  assertInput(contentType: string, sizeBytes: number): void {
    if (!this.config.documents.allowedContentTypes.includes(contentType))
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Document content type is not allowed',
      );
    if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > this.config.documents.maxBytes)
      throw new AppError(
        ErrorCode.PAYLOAD_TOO_LARGE,
        HttpStatus.PAYLOAD_TOO_LARGE,
        'Document size is not allowed',
      );
  }
  private ready(): { client: S3Client; bucket: string } {
    const bucket = this.config.documents.storage?.bucket;
    if (!this.client || !bucket)
      throw new AppError(
        ErrorCode.DOCUMENT_STORAGE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Private document storage is not configured',
      );
    return { client: this.client, bucket };
  }
  assertOperational(): void {
    this.ready();
    if (!this.config.documents.scanner)
      throw new AppError(
        ErrorCode.DOCUMENT_STORAGE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Document scanning is not configured',
      );
  }
  async uploadUrl(input: UploadDescriptor) {
    const { client, bucket } = this.ready();
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
      ServerSideEncryption: 'AES256',
      Metadata: { documentid: input.documentId },
    });
    return {
      url: await getSignedUrl(client, command, {
        expiresIn: this.config.documents.uploadTtlSeconds,
      }),
      expiresInSeconds: this.config.documents.uploadTtlSeconds,
      headers: {
        'content-type': input.contentType,
        'content-length': String(input.sizeBytes),
        'x-amz-server-side-encryption': 'AES256',
      },
    };
  }
  async verifyUpload(input: UploadDescriptor): Promise<VerifiedUpload> {
    const { client, bucket } = this.ready();
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: input.key }));
    const storageVersionId = head.VersionId;
    const storageETag = normalizeETag(head.ETag);
    if (
      head.ContentLength !== input.sizeBytes ||
      head.ContentType !== input.contentType ||
      head.Metadata?.documentid !== input.documentId ||
      head.ServerSideEncryption !== 'AES256' ||
      !storageVersionId ||
      !storageETag
    )
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Uploaded document metadata does not match the upload request',
      );
    const object = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: input.key, VersionId: storageVersionId }),
    );
    if (!object.Body)
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Uploaded document has no content',
      );
    const hash = createHash('sha256');
    let read = 0;
    let prefix = Buffer.alloc(0);
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      if (prefix.length < 12)
        prefix = Buffer.concat([prefix, Buffer.from(chunk).subarray(0, 12 - prefix.length)]);
      read += chunk.byteLength;
      if (read > input.sizeBytes)
        throw new AppError(
          ErrorCode.VALIDATION_FAILED,
          HttpStatus.BAD_REQUEST,
          'Uploaded document is larger than declared',
        );
      hash.update(chunk);
    }
    if (read !== input.sizeBytes)
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Uploaded document size does not match the upload request',
      );
    const detected = prefix.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      ? 'image/jpeg'
      : prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'image/png'
        : prefix.subarray(0, 5).toString('ascii') === '%PDF-'
          ? 'application/pdf'
          : null;
    if (detected !== input.contentType)
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        400,
        'Document bytes do not match the declared file type',
      );
    return { checksumSha256: hash.digest('hex'), storageVersionId, storageETag };
  }
  async scan(input: StoredDocumentDescriptor): Promise<ScanResult> {
    const scanner = this.config.documents.scanner;
    if (!scanner || scanner.kind !== 'http')
      throw new AppError(
        ErrorCode.DOCUMENT_STORAGE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Document scanner is not configured',
      );
    const downloadUrl = await this.downloadUrl(input.key, 60, input.storageVersionId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const response = await fetch(scanner.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${scanner.token}` },
      body: JSON.stringify({
        downloadUrl,
        sha256: input.checksumSha256,
        sizeBytes: input.sizeBytes,
        contentType: input.contentType,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!response.ok) throw new Error('DOCUMENT_SCAN_FAILED');
    const body = (await response.json()) as {
      result?: unknown;
      detectedContentType?: unknown;
      sha256?: unknown;
    };
    if (body.result !== 'CLEAN' && body.result !== 'INFECTED')
      throw new Error('DOCUMENT_SCAN_INVALID_RESULT');
    if (body.sha256 !== input.checksumSha256 || body.detectedContentType !== input.contentType)
      throw new Error('DOCUMENT_SCAN_INTEGRITY_MISMATCH');
    return body.result;
  }
  isGuardDutyScanner(): boolean {
    return this.config.documents.scanner?.kind === 'guardduty';
  }
  /**
   * GuardDuty's EventBridge payload is not enough to trust a result. This validates the immutable
   * S3 version and GuardDuty-managed tag using backend AWS credentials before a document moves on.
   */
  async assertGuardDutyClean(input: StoredDocumentDescriptor): Promise<void> {
    if (!this.isGuardDutyScanner())
      throw new AppError(
        ErrorCode.DOCUMENT_STORAGE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'GuardDuty scanning is not configured',
      );
    const { client, bucket } = this.ready();
    const [head, tags] = await Promise.all([
      client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: input.key,
          VersionId: input.storageVersionId,
        }),
      ),
      client.send(
        new GetObjectTaggingCommand({
          Bucket: bucket,
          Key: input.key,
          VersionId: input.storageVersionId,
        }),
      ),
    ]);
    const clean = tags.TagSet?.some(
      (tag) => tag.Key === 'GuardDutyMalwareScanStatus' && tag.Value === 'NO_THREATS_FOUND',
    );
    if (
      !clean ||
      head.VersionId !== input.storageVersionId ||
      normalizeETag(head.ETag) !== input.storageETag ||
      head.ContentLength !== input.sizeBytes ||
      head.ContentType !== input.contentType ||
      head.Metadata?.documentid !== input.documentId ||
      head.ServerSideEncryption !== 'AES256'
    ) {
      throw new AppError(
        ErrorCode.DOCUMENT_STORAGE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'GuardDuty clean result could not be verified for this object version',
      );
    }
  }
  async downloadUrl(
    key: string,
    ttl = this.config.documents.downloadTtlSeconds,
    versionId?: string,
  ): Promise<string> {
    const { client, bucket } = this.ready();
    return getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        VersionId: versionId,
        ResponseCacheControl: 'no-store',
      }),
      { expiresIn: ttl },
    );
  }
}

function normalizeETag(value: string | undefined): string | null {
  const normalized = value?.replace(/^"|"$/g, '').trim();
  return normalized || null;
}
