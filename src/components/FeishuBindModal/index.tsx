import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Input, Modal } from 'antd';
import { SyncOutlined } from '@ant-design/icons';

import { confirmFeishuBind, feishuBindStatus, startFeishuBind } from '@/api/auth';
import { CopyButton } from '@/ui/components/CopyButton';

import styles from './styles.module.scss';

const CONFIRM_CODE_LENGTH = 8;
const POLL_INTERVAL_MS = 2000;

/**
 * 绑定飞书。
 *
 * 原来是账号页的私有弹窗；「飞书绑定」板块也需要同一条握手（从列表直接发起
 * 绑定），所以上提到 `components/`。流程不变：控制台铸码 → 用户去飞书私聊
 * 机器人发命令 → 机器人回 8 位确认码 → 填回这里。
 *
 * # 弹窗生命周期
 *
 * 轮询只在 `open && code` 时存在，关闭即清定时器；`sessionRef` 让关闭/重开时
 * 在途请求的响应被丢弃，`startedRef` 防 StrictMode 重复铸码，`finishedRef`
 * 防「轮询发现已绑定」与「手动确认成功」重复收尾。
 */
export default function FeishuBindModal({
  open,
  onClose,
  onBound,
}: {
  open: boolean;
  onClose: () => void;
  /** 绑定成功后刷新账号信息（父组件传入的稳定回调）。 */
  onBound: () => Promise<void>;
}) {
  const { message } = App.useApp();

  const [starting, setStarting] = useState(false);
  const [code, setCode] = useState('');
  const [command, setCommand] = useState('');
  const [expired, setExpired] = useState(false);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const [confirmCode, setConfirmCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [startError, setStartError] = useState('');
  const [bindError, setBindError] = useState('');
  const [pollError, setPollError] = useState('');

  const startedRef = useRef(false);
  const sessionRef = useRef(0);
  const finishedRef = useRef(false);
  const confirmInFlightRef = useRef(false);

  const finish = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;

    setCode('');
    setCommand('');
    setExpired(false);
    setAwaitingConfirm(false);
    setConfirmCode('');
    setBindError('');
    setPollError('');

    message.success('飞书绑定成功');
    try {
      await onBound();
    } catch {
      // 刷新失败不影响绑定结果；下次进入页面会重新拉取。
    } finally {
      onClose();
    }
  }, [message, onBound, onClose]);

  /** 铸一张新的绑定码。关闭/重开后旧响应由 `sessionRef` 丢弃。 */
  const mint = useCallback(async () => {
    const session = ++sessionRef.current;
    finishedRef.current = false;
    setCode('');
    setCommand('');
    setExpired(false);
    setAwaitingConfirm(false);
    setConfirmCode('');
    setStartError('');
    setBindError('');
    setPollError('');
    setStarting(true);

    try {
      const next = await startFeishuBind();
      if (sessionRef.current !== session) return;
      setCode(next.code);
      setCommand(next.command);
    } catch (err) {
      if (sessionRef.current === session) {
        setStartError(err instanceof Error ? err.message : '无法开始绑定');
      }
    } finally {
      if (sessionRef.current === session) setStarting(false);
    }
  }, []);

  // 打开时铸码；关闭时作废当前会话并允许下次重新开始。
  useEffect(() => {
    if (!open) {
      sessionRef.current += 1;
      startedRef.current = false;
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    void mint();
  }, [open, mint]);

  // 轮询绑定状态。依赖 `open && code`：成功/过期时清空 code 即自然停止。
  useEffect(() => {
    if (!open || !code) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const status = await feishuBindStatus(code);
        if (cancelled) return;

        setPollError('');
        if (status.bound) {
          void finish();
          return;
        }
        if (status.expired) {
          setCode('');
          setCommand('');
          setAwaitingConfirm(false);
          setConfirmCode('');
          setPollError('');
          setExpired(true);
          return;
        }
        setAwaitingConfirm(status.awaiting_confirm);
      } catch (err) {
        if (!cancelled) {
          setPollError(err instanceof Error ? err.message : '查询绑定状态失败');
        }
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, code, finish]);

  const close = useCallback(() => {
    if (confirming) return;
    sessionRef.current += 1;
    startedRef.current = false;
    onClose();
  }, [confirming, onClose]);

  const submitConfirm = async () => {
    if (!code || confirmCode.length !== CONFIRM_CODE_LENGTH || confirmInFlightRef.current) return;

    confirmInFlightRef.current = true;
    setConfirming(true);
    setBindError('');
    try {
      await confirmFeishuBind(code, confirmCode);
      await finish();
    } catch (err) {
      setBindError(err instanceof Error ? err.message : '确认码提交失败');
    } finally {
      confirmInFlightRef.current = false;
      setConfirming(false);
    }
  };

  return (
    <Modal
      title="绑定飞书"
      open={open}
      footer={null}
      width={520}
      maskClosable={!confirming}
      closable={!confirming}
      keyboard={!confirming}
      onCancel={close}
    >
      <div className={styles.bindFlow}>
        {expired ? (
          <>
            <Alert
              type="warning"
              showIcon
              title="绑定码已失效"
              description="请重新生成绑定码，再回到飞书发送。"
            />
            <div>
              <Button type="primary" loading={starting} onClick={() => void mint()}>
                重新开始
              </Button>
            </div>
          </>
        ) : (
          <>
            <div>
              <div className={styles.bindStepTitle}>
                <span className={styles.bindStepIndex}>1</span>
                在飞书里打开 OneX 机器人
              </div>
              <p className={styles.bindHint}>请在飞书中找到 OneX 机器人并开始私聊。</p>
            </div>

            <div>
              <div className={styles.bindStepTitle}>
                <span className={styles.bindStepIndex}>2</span>
                把下面这条命令发给机器人
              </div>
              {command ? (
                <>
                  <div className={styles.bindRow}>
                    <Input
                      className={styles.bindRowInput}
                      value={command}
                      readOnly
                      aria-label="飞书绑定命令"
                    />
                    <CopyButton
                      value={command}
                      size="middle"
                      successText="已复制，去飞书发送吧"
                    />
                  </div>
                  <p className={styles.bindHint}>请私聊发送；绑定码十分钟内有效。</p>
                </>
              ) : starting ? (
                <p className={styles.bindHint}>
                  <SyncOutlined spin />
                  正在生成绑定码…
                </p>
              ) : (
                <p className={styles.bindHint}>绑定码尚未生成。</p>
              )}
            </div>

            {command && (
              <div>
                <div className={styles.bindStepTitle}>
                  <span className={styles.bindStepIndex}>3</span>
                  回到本页填写确认码
                </div>
                {awaitingConfirm ? (
                  <>
                    <div className={styles.bindRow}>
                      <Input
                        className={styles.bindRowInput}
                        value={confirmCode}
                        onChange={event =>
                          setConfirmCode(
                            event.target.value.replace(/\D/g, '').slice(0, CONFIRM_CODE_LENGTH)
                          )
                        }
                        onPressEnter={() => void submitConfirm()}
                        placeholder="机器人回复的 8 位确认码"
                        aria-label="飞书确认码"
                        inputMode="numeric"
                        maxLength={CONFIRM_CODE_LENGTH}
                        autoComplete="one-time-code"
                      />
                      <Button
                        type="primary"
                        loading={confirming}
                        disabled={confirmCode.length !== CONFIRM_CODE_LENGTH}
                        onClick={() => void submitConfirm()}
                      >
                        完成绑定
                      </Button>
                    </div>
                    <p className={styles.bindHint}>填满 8 位后提交；有效期十分钟。</p>
                  </>
                ) : (
                  <p className={styles.bindHint}>
                    <SyncOutlined spin />
                    正在等待你在飞书里发送上面的命令…
                  </p>
                )}
              </div>
            )}

            {startError && (
              <Alert
                type="error"
                showIcon
                title={startError}
                action={
                  <Button size="small" loading={starting} onClick={() => void mint()}>
                    重新生成
                  </Button>
                }
              />
            )}
          </>
        )}

        {bindError && <Alert type="error" showIcon title={bindError} />}
        {pollError && <Alert type="warning" showIcon title={pollError} />}
      </div>
    </Modal>
  );
}
