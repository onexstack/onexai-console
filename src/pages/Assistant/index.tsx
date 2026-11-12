import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, Input, Select } from 'antd';
import {
  ArrowRightOutlined,
  ClockCircleOutlined,
  CodeOutlined,
  PlusOutlined,
  SendOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';

import SessionGate from '@/components/SessionGate';
import styles from './styles.module.scss';

/**
 * 智能助手（原型交互）。
 *
 * # 为什么这里是本地状态而不是接口
 *
 * 参考图面向的是「只读原型环境」：对话列表、推荐的 Skill / 知识库组合、消息回显
 * 都是用来确认页面组织方式的。真实的后端会话（群列表、历史、检索）在
 * `/conversations`，入口放在左侧对话面板底部；真实的流式推理在资源详情页的调试
 * 页签里。把两条链路混进这一页会让它看起来像已经接上了推理能力，而其实没有。
 *
 * 消息与调试日志全部在内存里：刷新即回到初始的两条示例对话，这是原型该有的行为。
 */

type MessageRole = 'ai' | 'user';

interface AssistantMessage {
  id: string;
  role: MessageRole;
  content: string;
}

interface ConversationItem {
  id: string;
  title: string;
  time: string;
  summary: string;
  messages: AssistantMessage[];
}

interface DebugLine {
  id: number;
  time: string;
  text: string;
}

interface SelectOption {
  value: string;
  label: string;
}

const MODEL_OPTIONS: SelectOption[] = [
  { value: 'gpt-5.4-pro', label: 'GPT-5.4 Pro' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
];

const SKILL_OPTIONS: SelectOption[] = [
  { value: 'default', label: 'default（通用对话）' },
  { value: 'fault_diagnosis', label: 'fault_diagnosis（故障诊断）' },
  { value: 'release_rollback', label: 'release_rollback（发布回滚）' },
];

const KB_OPTIONS: SelectOption[] = [
  { value: 'kb_prod_incident', label: 'kb_prod_incident（生产故障知识库）' },
  { value: 'kb_runbook', label: 'kb_runbook（运维手册）' },
  { value: '', label: '不启用' },
];

const MCP_OPTIONS: SelectOption[] = [
  { value: 'mcp-incident', label: 'mcp-incident（故障单 & 事件）' },
  { value: 'mcp-monitor', label: 'mcp-monitor（监控告警）' },
  { value: '', label: '不启用' },
];

const BIZ_LINE_OPTIONS: SelectOption[] = [
  { value: 'all', label: '全部业务线' },
  { value: 'trade', label: '交易业务线' },
  { value: 'payment', label: '支付业务线' },
  { value: 'infra', label: '基础设施' },
];

const INITIAL_CONVERSATIONS: ConversationItem[] = [
  {
    id: 'conv-latency',
    title: '排查线上延迟',
    time: '2 小时前',
    summary: '查看最近的错误率趋势',
    messages: [
      { id: 'msg-1', role: 'ai', content: '你好，我可以帮你排查什么问题？' },
      { id: 'msg-2', role: 'user', content: '查看最近的错误率趋势' },
    ],
  },
  {
    id: 'conv-release',
    title: '发布回滚流程',
    time: '1 天前',
    summary: '简短摘要或首行预览',
    messages: [
      { id: 'msg-3', role: 'ai', content: '你好，我可以帮你排查什么问题？' },
      { id: 'msg-4', role: 'user', content: '发布失败后应该按什么顺序回滚？' },
      {
        id: 'msg-5',
        role: 'ai',
        content:
          '建议先停止灰度放量，再回滚应用版本，最后核对数据变更。\n\n当前是只读原型环境，真实排障链路接入后会在这里返回流式结果。',
      },
    ],
  },
];

/** 选项值 → 展示文案；找不到时原样返回，避免下拉里出现空串。 */
function labelOf(options: SelectOption[], value: string): string {
  return options.find(option => option.value === value)?.label ?? value;
}

/** 调试日志的时间戳：只到秒，和消息内容一样紧凑。 */
function nowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

export default function AssistantPage() {
  const [conversations, setConversations] = useState<ConversationItem[]>(() =>
    INITIAL_CONVERSATIONS.map(conversation => ({
      ...conversation,
      messages: conversation.messages.map(message => ({ ...message })),
    }))
  );
  const [activeId, setActiveId] = useState(INITIAL_CONVERSATIONS[0]?.id ?? '');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const [bizLine, setBizLine] = useState('all');
  const [model, setModel] = useState('gpt-5.4-pro');
  const [skill, setSkill] = useState('default');
  const [knowledgeBase, setKnowledgeBase] = useState('kb_prod_incident');
  const [mcp, setMcp] = useState('mcp-incident');

  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLines, setDebugLines] = useState<DebugLine[]>([]);

  const messageListRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const seqRef = useRef(0);

  const activeConversation = conversations.find(item => item.id === activeId);
  const activeMessages = activeConversation?.messages ?? [];

  // 切换对话或追加消息后滚到底部：会话区自己有一个滚动容器，新消息不该在视口外。
  useEffect(() => {
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
    // debugOpen 也要算进去：展开日志会压缩消息区，不重新贴底就会停在顶部、只看到
    // 一条被裁掉一半的回复。
  }, [activeId, activeMessages.length, sending, debugOpen]);

  // 卸载时清掉原型回复的定时器，否则它会在一个已经卸载的组件上 setState。
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    []
  );

  const addDebug = (text: string) => {
    seqRef.current += 1;
    const line: DebugLine = { id: seqRef.current, time: nowTime(), text };
    setDebugLines(previous => [...previous.slice(-49), line]);
  };

  const appendMessage = (conversationId: string, message: AssistantMessage) => {
    setConversations(previous =>
      previous.map(conversation =>
        conversation.id === conversationId
          ? { ...conversation, messages: [...conversation.messages, message] }
          : conversation
      )
    );
  };

  const handleSend = (
    preset?: string,
    overrides?: { skill?: string; knowledgeBase?: string; mcp?: string }
  ) => {
    const content = (preset ?? input).trim();
    if (!content || sending) return;

    const conversationId = activeId;
    const effectiveSkill = overrides?.skill ?? skill;
    const effectiveKnowledgeBase = overrides?.knowledgeBase ?? knowledgeBase;
    const effectiveMcp = overrides?.mcp ?? mcp;
    // 必须在追加消息**之前**判断：追加之后再读，长度永远不为 0。
    const isFirstMessage = activeMessages.length === 0;

    appendMessage(conversationId, { id: `msg-${Date.now()}`, role: 'user', content });
    setConversations(previous =>
      previous.map(conversation =>
        conversation.id === conversationId
          ? {
              ...conversation,
              summary: content,
              title: isFirstMessage ? content.slice(0, 12) : conversation.title,
            }
          : conversation
      )
    );
    setInput('');
    setSending(true);

    addDebug(`收到用户消息（${content.length} 字）`);
    addDebug(`挂载 Skill：${labelOf(SKILL_OPTIONS, effectiveSkill)}`);
    if (effectiveKnowledgeBase) {
      addDebug(`检索知识库：${labelOf(KB_OPTIONS, effectiveKnowledgeBase)}`);
    }
    if (effectiveMcp) addDebug(`连接 MCP：${labelOf(MCP_OPTIONS, effectiveMcp)}`);
    addDebug(`调用模型：${labelOf(MODEL_OPTIONS, model)}`);

    timerRef.current = window.setTimeout(() => {
      const reply = [
        `【原型演示】我会使用「${labelOf(MODEL_OPTIONS, model)}」结合「${labelOf(SKILL_OPTIONS, effectiveSkill)}」来回答。`,
        effectiveKnowledgeBase
          ? `参考知识库：${labelOf(KB_OPTIONS, effectiveKnowledgeBase)}。`
          : '',
        effectiveMcp ? `可用 MCP：${labelOf(MCP_OPTIONS, effectiveMcp)}。` : '',
        `你问的是：${content}`,
        '当前是只读原型环境，真实推理链路接入后，这里会返回流式分析结果。',
      ]
        .filter(Boolean)
        .join('\n');

      appendMessage(conversationId, {
        id: `msg-${Date.now()}-reply`,
        role: 'ai',
        content: reply,
      });
      setSending(false);
      addDebug('生成完成（原型占位回复）');
    }, 700);
  };

  const handleSuggestion = () => {
    setSkill('fault_diagnosis');
    setKnowledgeBase('kb_prod_incident');
    setMcp('mcp-incident');
    addDebug('已套用推荐组合：故障排查助手');
    handleSend('帮我排查一下线上延迟问题', {
      skill: 'fault_diagnosis',
      knowledgeBase: 'kb_prod_incident',
      mcp: 'mcp-incident',
    });
  };

  const handleNewConversation = () => {
    const id = `conv-${Date.now()}`;
    const conversation: ConversationItem = {
      id,
      title: '新对话',
      time: '刚刚',
      summary: '开始一段新的排查会话',
      messages: [],
    };
    setConversations(previous => [conversation, ...previous]);
    setActiveId(id);
    setInput('');
    setDebugLines([]);
    addDebug('已创建新对话');
  };

  return (
    <SessionGate>
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <div className={styles.bizLine}>
            <span className={styles.bizLabel}>业务线</span>
            <Select
              className={styles.bizSelect}
              value={bizLine}
              onChange={setBizLine}
              options={BIZ_LINE_OPTIONS}
            />
          </div>
          <div className={styles.envInfo}>
            <div className={styles.envGroup}>
              <span className={styles.envLabel}>ENV</span>
              <span className={styles.envBadge}>Demo</span>
            </div>
            <div className={styles.teamGroup}>
              <span className={styles.teamName}>SRE 团队</span>
              <span className={styles.teamRole}>只读原型环境</span>
            </div>
          </div>
        </header>

        <div className={styles.body}>
          <aside className={styles.convPanel}>
            <div className={styles.convHead}>
              <h2 className={styles.convTitle}>对话列表</h2>
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={handleNewConversation}
              >
                新对话
              </Button>
            </div>

            <div className={styles.convList}>
              {conversations.map(conversation => {
                const active = conversation.id === activeId;
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    className={`${styles.convItem} ${active ? styles.convItemActive : ''}`}
                    onClick={() => setActiveId(conversation.id)}
                  >
                    <span className={styles.convItemTop}>
                      <span className={styles.convItemTitle}>{conversation.title}</span>
                      <span className={styles.convItemTime}>{conversation.time}</span>
                    </span>
                    <span className={styles.convItemSummary}>{conversation.summary}</span>
                  </button>
                );
              })}
            </div>

            <div className={styles.convFooter}>
              <Link className={styles.allConversations} to="/conversations">
                <UnorderedListOutlined />
                查看全部真实会话
                <ArrowRightOutlined />
              </Link>
            </div>
          </aside>

          <main className={styles.main}>
            <section className={styles.hero}>
              <h1 className={styles.heroTitle}>你好，</h1>
              <p className={styles.heroSub}>我今天能帮你什么？</p>

              <button type="button" className={styles.suggestion} onClick={handleSuggestion}>
                <span className={styles.suggestionBody}>
                  <span className={styles.suggestionTitle}>试用故障排查助手</span>
                  <span className={styles.suggestionDesc}>
                    最佳搭配：生产故障知识库 · fault_diagnosis Skill
                  </span>
                </span>
                <span className={styles.suggestionArrow}>
                  <ArrowRightOutlined />
                </span>
              </button>
            </section>

            <section className={styles.chatCard}>
              <div ref={messageListRef} className={styles.messages}>
                {activeMessages.length === 0 && !sending && (
                  <div className={styles.emptyHint}>在下方输入消息，开始新的排查会话。</div>
                )}
                {activeMessages.map(message => (
                  <div
                    key={message.id}
                    className={`${styles.msgRow} ${message.role === 'user' ? styles.msgRowUser : ''}`}
                  >
                    <div
                      className={`${styles.bubble} ${message.role === 'user' ? styles.bubbleUser : styles.bubbleAi}`}
                    >
                      {message.content}
                    </div>
                  </div>
                ))}
                {sending && (
                  <div className={styles.msgRow}>
                    <div className={`${styles.bubble} ${styles.bubbleAi} ${styles.typing}`}>
                      正在生成…
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.metaRow}>
                <label className={styles.metaField}>
                  <span className={styles.metaLabel}>模型</span>
                  <Select value={model} onChange={setModel} options={MODEL_OPTIONS} />
                </label>
                <label className={styles.metaField}>
                  <span className={styles.metaLabel}>Skill</span>
                  <Select value={skill} onChange={setSkill} options={SKILL_OPTIONS} />
                </label>
                <label className={styles.metaField}>
                  <span className={styles.metaLabel}>知识库</span>
                  <Select value={knowledgeBase} onChange={setKnowledgeBase} options={KB_OPTIONS} />
                </label>
                <label className={styles.metaField}>
                  <span className={styles.metaLabel}>MCP</span>
                  <Select value={mcp} onChange={setMcp} options={MCP_OPTIONS} />
                </label>
              </div>

              <div className={styles.debugBar}>
                <Button
                  size="small"
                  icon={<CodeOutlined />}
                  className={styles.debugToggle}
                  onClick={() => setDebugOpen(open => !open)}
                >
                  调试日志
                </Button>
                {debugOpen && (
                  <div className={styles.debugLog}>
                    {debugLines.length === 0 ? (
                      <div className={styles.debugEmpty}>暂无调试事件</div>
                    ) : (
                      debugLines.map(line => (
                        <div key={line.id} className={styles.debugLine}>
                          <span className={styles.debugTime}>{line.time}</span>
                          <span>{line.text}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div className={styles.composerBlock}>
                <div className={styles.composerLabel}>
                  <ClockCircleOutlined />
                  会话输入
                </div>
                <div className={styles.composer}>
                  <Input.TextArea
                    className={styles.composerInput}
                    value={input}
                    onChange={event => setInput(event.target.value)}
                    onKeyDown={event => {
                      // 中文输入法组词时的回车不是「发送」。
                      if (event.nativeEvent.isComposing) return;
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        handleSend();
                      }
                    }}
                    placeholder="输入消息，回车发送"
                    autoSize={{ minRows: 1, maxRows: 4 }}
                  />
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    className={styles.sendBtn}
                    disabled={!input.trim() || sending}
                    onClick={() => handleSend()}
                  >
                    发送
                  </Button>
                </div>
              </div>
            </section>
          </main>
        </div>
      </div>
    </SessionGate>
  );
}
