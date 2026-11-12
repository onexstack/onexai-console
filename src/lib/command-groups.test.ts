import { describe, expect, it } from 'vitest';

import {
  COMMAND_GROUP_LABEL_KEY,
  commandGroupKey,
  commandGroupLabel,
  commandGroupTagLabel,
  commandGroupsOf,
  commandGroupValuesOf,
  isCommandGroupValue,
  mergeCommandSelector,
} from './command-groups';

describe('command group helpers', () => {
  it('recognises the group prefix', () => {
    expect(isCommandGroupValue('group:duty')).toBe(true);
    expect(isCommandGroupValue('oncall')).toBe(false);
    expect(commandGroupKey('group:duty')).toBe('duty');
  });

  it('renders a human label and falls back to the key', () => {
    expect(commandGroupLabel('duty')).toBe('值班');
    expect(commandGroupLabel('unknown')).toBe('unknown');
    expect(commandGroupTagLabel('duty')).toBe('值班组');
  });

  it('reads groups from matchLabels and In expressions only', () => {
    const selector = {
      matchLabels: { [COMMAND_GROUP_LABEL_KEY]: 'core' },
      matchExpressions: [
        { key: COMMAND_GROUP_LABEL_KEY, operator: 'In', values: ['duty', 'ai'] },
        { key: COMMAND_GROUP_LABEL_KEY, operator: 'NotIn', values: ['job'] },
        { key: 'scope', operator: 'In', values: ['readonly'] },
      ],
    };
    expect(commandGroupsOf(selector)).toEqual(['ai', 'core', 'duty']);
    expect(commandGroupValuesOf(selector)).toEqual(['group:ai', 'group:core', 'group:duty']);
  });

  it('ignores malformed selectors', () => {
    expect(commandGroupsOf(undefined)).toEqual([]);
    expect(commandGroupsOf('nope')).toEqual([]);
    expect(commandGroupsOf([])).toEqual([]);
  });

  it('writes groups back and preserves the other expressions', () => {
    const base = {
      matchLabels: { team: 'sre', [COMMAND_GROUP_LABEL_KEY]: 'core' },
      matchExpressions: [
        { key: COMMAND_GROUP_LABEL_KEY, operator: 'In', values: ['job'] },
        { key: 'scope', operator: 'In', values: ['readonly'] },
      ],
    };

    expect(mergeCommandSelector(base, ['duty', 'duty'])).toEqual({
      matchLabels: { team: 'sre' },
      matchExpressions: [
        { key: 'scope', operator: 'In', values: ['readonly'] },
        { key: COMMAND_GROUP_LABEL_KEY, operator: 'In', values: ['duty'] },
      ],
    });
  });

  it('drops the selector when nothing is left', () => {
    expect(mergeCommandSelector({ matchExpressions: [] }, [])).toBeUndefined();
    expect(
      mergeCommandSelector(
        { matchExpressions: [{ key: COMMAND_GROUP_LABEL_KEY, operator: 'In', values: ['duty'] }] },
        []
      )
    ).toBeUndefined();
  });
});
