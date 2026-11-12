/** 服务端给出的只读原因，翻成一句能指导下一步动作的话。 */
export function reasonText(reason: string): string {
  switch (reason) {
    case 'external':
      return '该绑定由 onex-iam 管理，控制台只读；如需变更请在 onex-iam 中操作。';
    case 'no_peer':
      return '账号已绑定飞书，但机器人侧还没有 PeerBinding，@peer 暂时不可用。请重新绑定或检查部署。';
    case 'canonical_mismatch':
      return '这条飞书身份在机器人侧指向了另一个平台账号，请先解绑后重新绑定。';
    case 'unknown_source':
      return '该绑定的来源未知，控制台不可修改。';
    case 'canonical_missing':
      return '机器人侧的绑定没有关联平台账号，无法确定授权主体。';
    case 'not_owner':
      return '你只能管理自己的飞书绑定。';
    default:
      return '当前绑定不可修改。';
  }
}
