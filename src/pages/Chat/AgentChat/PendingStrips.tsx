import { CloseOutlined, FileOutlined, LoadingOutlined } from '@ant-design/icons';

import { formatBytes } from './chatUtils';
import type { PendingAttachment, PendingImage } from './types';
import styles from './styles.module.scss';

export function PendingImageStrip({
  images,
  onRemove,
}: {
  images: PendingImage[];
  onRemove: (id: string) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className={styles.pendingImages}>
      {images.map(image => (
        <div key={image.id} className={styles.pendingImage} title={image.name}>
          <img src={image.previewURL} alt={image.name} />
          {image.status === 'uploading' && (
            <span className={styles.pendingOverlay}>
              <LoadingOutlined />
            </span>
          )}
          <button
            type="button"
            className={styles.pendingRemove}
            onClick={() => onRemove(image.id)}
            aria-label={`移除 ${image.name}`}
          >
            <CloseOutlined />
          </button>
        </div>
      ))}
    </div>
  );
}

export function PendingAttachmentStrip({
  attachments,
  onRemove,
}: {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className={styles.pendingAttachments}>
      {attachments.map(attachment => (
        <div key={attachment.id} className={styles.pendingAttachment} title={attachment.name}>
          <FileOutlined />
          <span className={styles.pendingAttachmentName}>{attachment.name}</span>
          <em>{formatBytes(attachment.size)}</em>
          <button
            type="button"
            className={styles.pendingRemoveInline}
            onClick={() => onRemove(attachment.id)}
            aria-label={`移除 ${attachment.name}`}
          >
            <CloseOutlined />
          </button>
        </div>
      ))}
    </div>
  );
}
