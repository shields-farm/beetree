import { useState } from 'react';
import {
  Flame, Hand, Shirt, Footprints, Wrench, Droplet,
  ExternalLink, Search, ShoppingBag,
} from 'lucide-react';
import { PageHeader } from '../components/Layout';
import { Card } from '../components/Card';

interface GearItem {
  name: string;
  url: string;
  note?: string;
}

interface GearCategory {
  id: string;
  label: string;
  icon: typeof Flame;
  items: GearItem[];
}

const GEAR_CATEGORIES: GearCategory[] = [
  {
    id: 'smoker',
    label: 'Smoker Fuel',
    icon: Flame,
    items: [
      { name: 'Bee Smoker Circles', url: 'https://beesmokerfuel.com', note: 'Pre-formed smoker circles — Mark\'s preferred fuel' },
    ],
  },
  {
    id: 'gloves',
    label: 'Gloves',
    icon: Hand,
    items: [
      { name: 'Apis Tactical Professional Beekeeping Gloves', url: 'https://apis-tactical.com/products/professional-beekeeping-gloves' },
    ],
  },
  {
    id: 'suits',
    label: 'Protective Suits',
    icon: Shirt,
    items: [
      { name: 'ProVent Full Suit', url: 'https://www.mannlakeltd.com/hives-components/beginner-essentials/provent-beekeeping-suit/' },
      { name: 'ProVent Pants', url: 'https://www.mannlakeltd.com/protective-gear/provent-beekeeping-pants/' },
      { name: 'ProVent Jacket', url: 'https://www.mannlakeltd.com/hives-components/beginner-essentials/provent-beekeeping-jacket/' },
      { name: 'ProVent Replacement Hooded Veil', url: 'https://www.mannlakeltd.com/helmets-veils/provent-replacement-hooded-veils/' },
    ],
  },
  {
    id: 'boots',
    label: 'Boots',
    icon: Footprints,
    items: [
      { name: 'Muck Boot Co (for000)', url: 'https://muckbootcompany.com/collections/mens-boots/products/for000' },
    ],
  },
  {
    id: 'tools',
    label: 'Hive Tools',
    icon: Wrench,
    items: [
      { name: 'QWORK Multifunctional Hive Tool', url: 'https://www.amazon.com/QWORK-Hive-Tool-Multifunctional-Beekeeping/dp/B0F1KLN1Z1' },
      { name: 'HiveAlive Find-Pro Hive Tool', url: 'https://www.amazon.com/HiveAlive-Find-Pro-HiveTool-Multi-Color/dp/B0DMFKRD9X' },
    ],
  },
  {
    id: 'feeding',
    label: 'Feeding & Overwintering',
    icon: Droplet,
    items: [
      { name: 'HiveAlive Fondant Food Supplement', url: 'https://www.amazon.com/HIVE-ALIVE-Fondant-Food-Supplement/dp/B0GM25CQ2W', note: 'For overwintering — ready-to-use fondant' },
    ],
  },
];

export function Equipment() {
  const [search, setSearch] = useState('');

  const filtered = GEAR_CATEGORIES.map((cat) => ({
    ...cat,
    items: cat.items.filter((item) =>
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      (item.note ?? '').toLowerCase().includes(search.toLowerCase())
    ),
  })).filter((cat) => cat.items.length > 0);

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Equipment"
        subtitle="Recommended gear and suppliers"
        action={
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search gear..."
              className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 pl-9 pr-3 py-2 text-sm w-40 sm:w-56"
            />
          </div>
        }
      />

      {filtered.length === 0 && (
        <Card>
          <p className="text-sm text-stone-500 dark:text-stone-400 text-center py-6">
            No gear matches "{search}".
          </p>
        </Card>
      )}

      {filtered.map((cat) => {
        const Icon = cat.icon;
        return (
          <div key={cat.id}>
            <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-2 flex items-center gap-2">
              <Icon size={16} className="text-honey-600 dark:text-honey-400" />
              {cat.label}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {cat.items.map((item) => (
                <Card key={item.url}>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 hover:text-honey-600 dark:hover:text-honey-400 transition-colors group"
                  >
                    <div className="w-10 h-10 rounded-xl bg-honey-50 dark:bg-honey-950 flex items-center justify-center shrink-0">
                      <ShoppingBag size={18} className="text-honey-600 dark:text-honey-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-sm text-stone-800 dark:text-stone-100 group-hover:text-honey-600 dark:group-hover:text-honey-400">
                          {item.name}
                        </span>
                        <ExternalLink size={12} className="text-stone-400 dark:text-stone-500 shrink-0" />
                      </div>
                      {item.note && (
                        <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{item.note}</p>
                      )}
                      <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-1 truncate">
                        {new URL(item.url).hostname.replace('www.', '')}
                      </p>
                    </div>
                  </a>
                </Card>
              ))}
            </div>
          </div>
        );
      })}

      <p className="text-xs text-stone-400 dark:text-stone-500 text-center pt-2">
        Equipment recommendations are based on Mark's kit. Update in <code className="text-stone-500 dark:text-stone-400">src/pages/Equipment.tsx</code>.
      </p>
    </div>
  );
}