import { useEffect, useState } from 'react';
import { Image, Spin } from 'antd';

import { assetContentPath, fetchBlob, imagePath } from '@/api/chat';

/**
 * 需要 Bearer 令牌才能读取的图片。
 *
 * 不能把令牌拼进 `<img src>`：那会把凭据写进 DOM、历史记录和日志。这里用 axios
 * 带令牌取 blob，再转成 object URL；卸载时释放。
 */
export default function AuthImage({
  assetId,
  msgId,
  src,
  alt,
  width = 160,
}: {
  assetId?: string;
  msgId?: string;
  src?: string;
  alt?: string;
  width?: number;
}) {
  const external = src && /^(https?:|data:)/.test(src) ? src : undefined;
  const [url, setUrl] = useState<string | undefined>(external);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (url || (!assetId && !msgId)) return;
    let objectUrl: string | undefined;
    let cancelled = false;
    const path = assetId ? assetContentPath(assetId) : imagePath(msgId as string);
    fetchBlob(path)
      .then(blob => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, msgId, url]);

  if (failed) return <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>图片不可用</span>;
  if (!url) return <Spin size="small" />;
  return <Image src={url} alt={alt} width={width} style={{ borderRadius: 6 }} />;
}
