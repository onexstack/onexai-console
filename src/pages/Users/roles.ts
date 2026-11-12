/** 平台账号角色。与后端 `chat.user.role` 的枚举保持一致。 */
export const ROLE_OPTIONS = [
  { value: '', label: '普通用户' },
  { value: 'admin', label: '管理员' },
  { value: 'sre', label: 'SRE' },
];

export function roleLabel(role?: string): string {
  return ROLE_OPTIONS.find(option => option.value === (role ?? ''))?.label ?? role ?? '普通用户';
}
