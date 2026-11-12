import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from 'antd';

import { uploadAsset } from '@/api/chat';

import { CHAT_LIMITS, formatBytes, uid } from './chatUtils';
import type { PendingAttachment, PendingImage } from './types';

/**
 * 输入框里的待发图片与附件。
 *
 * - 图片：选图即上传（`POST /v1/assets`，仅 image），本地 object URL 先给预览。
 * - 附件：管理面的 ask 接口没有附件字段，这里只保存元数据供本地展示；
 *   后端支持后在这里补上传与 `attachmentID`。
 */
export function usePendingFiles() {
  const { message } = App.useApp();
  const [images, setImages] = useState<PendingImage[]>([]);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const imagesRef = useRef<PendingImage[]>([]);
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  const objectUrls = useRef<Set<string>>(new Set());

  imagesRef.current = images;
  attachmentsRef.current = attachments;

  const revoke = useCallback((url?: string) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrls.current.delete(url);
  }, []);

  useEffect(
    () => () => {
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
      objectUrls.current.clear();
    },
    []
  );

  const addImages = useCallback(
    (files: File[]) => {
      const room = CHAT_LIMITS.maxImages - imagesRef.current.length;
      if (room <= 0) {
        message.warning(`最多上传 ${CHAT_LIMITS.maxImages} 张图片`);
        return;
      }

      const accepted: { id: string; file: File; previewURL: string }[] = [];
      for (const file of files) {
        if (accepted.length >= room) {
          message.warning(`最多上传 ${CHAT_LIMITS.maxImages} 张图片`);
          break;
        }
        if (!file.type.startsWith('image/')) {
          message.warning(`${file.name} 不是图片`);
          continue;
        }
        if (file.size > CHAT_LIMITS.imageMaxBytes) {
          message.warning(`${file.name} 超过 ${formatBytes(CHAT_LIMITS.imageMaxBytes)}`);
          continue;
        }
        const previewURL = URL.createObjectURL(file);
        objectUrls.current.add(previewURL);
        accepted.push({ id: uid('img'), file, previewURL });
      }

      if (accepted.length === 0) return;

      setImages(prev => [
        ...prev,
        ...accepted.map(item => ({
          id: item.id,
          name: item.file.name,
          previewURL: item.previewURL,
          status: 'uploading' as const,
        })),
      ]);

      for (const item of accepted) {
        void uploadAsset(item.file)
          .then(asset => {
            setImages(prev =>
              prev.map(image =>
                image.id === item.id
                  ? {
                      ...image,
                      status: 'ready' as const,
                      assetId: asset.asset_id,
                      url: asset.url,
                    }
                  : image
              )
            );
          })
          .catch(error => {
            message.error(
              `${item.file.name} 上传失败：${error instanceof Error ? error.message : '未知错误'}`
            );
            setImages(prev => prev.filter(image => image.id !== item.id));
            revoke(item.previewURL);
          });
      }
    },
    [message, revoke]
  );

  const removeImage = useCallback(
    (id: string) => {
      setImages(prev => {
        const target = prev.find(image => image.id === id);
        revoke(target?.previewURL);
        return prev.filter(image => image.id !== id);
      });
    },
    [revoke]
  );

  const addAttachments = useCallback(
    (files: File[]) => {
      const room = CHAT_LIMITS.maxAttachments - attachmentsRef.current.length;
      if (room <= 0) {
        message.warning(`最多添加 ${CHAT_LIMITS.maxAttachments} 个附件`);
        return;
      }

      const accepted: PendingAttachment[] = [];
      for (const file of files) {
        if (accepted.length >= room) {
          message.warning(`最多添加 ${CHAT_LIMITS.maxAttachments} 个附件`);
          break;
        }
        if (file.size > CHAT_LIMITS.attachmentMaxBytes) {
          message.warning(`${file.name} 超过 ${formatBytes(CHAT_LIMITS.attachmentMaxBytes)}`);
          continue;
        }
        if (file.size === 0) {
          message.warning(`${file.name} 是空文件`);
          continue;
        }
        accepted.push({
          id: uid('att'),
          name: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
        });
      }

      if (accepted.length > 0) setAttachments(prev => [...prev, ...accepted]);
    },
    [message]
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(attachment => attachment.id !== id));
  }, []);

  const clear = useCallback(() => {
    setImages(prev => {
      for (const image of prev) revoke(image.previewURL);
      return [];
    });
    setAttachments([]);
  }, [revoke]);

  const uploading = images.some(image => image.status === 'uploading');
  const readyImages = images.filter(image => image.status === 'ready' && image.assetId);

  return {
    images,
    attachments,
    uploading,
    readyImages,
    addImages,
    removeImage,
    addAttachments,
    removeAttachment,
    clear,
  };
}
