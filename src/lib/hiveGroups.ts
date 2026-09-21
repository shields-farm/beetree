import type { HiveGroupTemplateId } from '../types';

/**
 * Yard group templates.
 *
 * The "Ellis Special" is Jamie Ellis's recommended yard arrangement (GBA
 * talk): pair two production hives with a nuc between them — the nuc acts as
 * a buffer resource/spare-queen bank for the pair, and the trio makes splits
 * and requeening local to the group.
 */
export const HIVE_GROUP_TEMPLATES: Record<HiveGroupTemplateId, {
  id: HiveGroupTemplateId;
  label: string;
  description: string;
  /** Layout slots, left to right as they sit in the yard. */
  slots: { role: 'hive' | 'nuc'; label: string }[];
}> = {
  'ellis-special': {
    id: 'ellis-special',
    label: 'Ellis Special',
    description: 'Two production hives with a nuc in the middle — Jamie Ellis\'s recommended pairing. The nuc banks a spare queen and buffers resources for the pair.',
    slots: [
      { role: 'hive', label: 'Hive' },
      { role: 'nuc', label: 'Nuc (middle)' },
      { role: 'hive', label: 'Hive' },
    ],
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    description: 'Group existing hives in a custom arrangement.',
    slots: [],
  },
};

export const ELLIS_SPECIAL_ID: HiveGroupTemplateId = 'ellis-special';