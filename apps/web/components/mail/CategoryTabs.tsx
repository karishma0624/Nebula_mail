'use client';

import React from 'react';
import { Inbox, Tag, Users, Info } from 'lucide-react';
import { useMailStore } from '../../lib/store';
import { EmailCategory } from '../../lib/types';

interface CategoryTabsProps {
  onCategoryChange?: (category: EmailCategory) => void;
}

export const CategoryTabs: React.FC<CategoryTabsProps> = ({ onCategoryChange }) => {
  const { activeCategory, setActiveCategory, categoryStats } = useMailStore();

  const tabs: {
    id: EmailCategory;
    label: string;
    icon: React.ReactNode;
    unread: number;
    badgeStyle: string;
  }[] = [
    {
      id: 'primary',
      label: 'Primary',
      icon: <Inbox size={16} />,
      unread: categoryStats?.primary?.unread || 0,
      badgeStyle: 'bg-blue-100 dark:bg-indigo-500/20 text-blue-700 dark:text-indigo-300 border-blue-200 dark:border-indigo-500/30',
    },
    {
      id: 'promotions',
      label: 'Promotions',
      icon: <Tag size={16} />,
      unread: categoryStats?.promotions?.unread || 0,
      badgeStyle: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
    },
    {
      id: 'social',
      label: 'Social',
      icon: <Users size={16} />,
      unread: categoryStats?.social?.unread || 0,
      badgeStyle: 'bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/30',
    },
    {
      id: 'updates',
      label: 'Updates',
      icon: <Info size={16} />,
      unread: categoryStats?.updates?.unread || 0,
      badgeStyle: 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
    },
  ];

  const handleTabClick = (categoryId: EmailCategory) => {
    if (activeCategory === categoryId) return;
    setActiveCategory(categoryId);
    onCategoryChange?.(categoryId);
  };

  return (
    <div className="flex items-center border-b border-slate-200 dark:border-slate-800/80 bg-white dark:bg-slate-900/40 px-3 select-none shrink-0 overflow-x-auto transition-colors">
      {tabs.map((tab) => {
        const isActive = activeCategory === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => handleTabClick(tab.id)}
            className={`group relative flex-1 max-w-[240px] min-w-[140px] flex items-center justify-start gap-2.5 px-4 py-3 text-xs transition-all duration-150 ${
              isActive
                ? 'text-blue-600 dark:text-indigo-300 font-bold'
                : 'text-slate-600 dark:text-slate-400 font-medium hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-slate-800/30'
            }`}
          >
            {/* Tab Icon */}
            <span
              className={`transition-colors ${
                isActive ? 'text-blue-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300'
              }`}
            >
              {tab.icon}
            </span>

            {/* Tab Label */}
            <span className="truncate">{tab.label}</span>

            {/* Unread Pill Badge */}
            {tab.unread > 0 && (
              <span
                className={`ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full border tracking-tight shrink-0 ${tab.badgeStyle}`}
              >
                {tab.unread.toLocaleString()}
              </span>
            )}

            {/* Active Bottom Indicator Bar */}
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-[3px] bg-blue-600 dark:bg-indigo-400 rounded-t" />
            )}
          </button>
        );
      })}

      {/* Subtle Category Count Explanation Info Indicator */}
      <div className="relative group ml-auto pr-3 pl-2 flex items-center shrink-0">
        <div 
          tabIndex={0}
          aria-label="Category count details"
          className="cursor-help p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/40 transition focus:outline-none"
        >
          <Info size={14} />
        </div>
        <div className="absolute right-3 top-full mt-1.5 hidden group-hover:block group-focus-within:block z-30 w-64 p-2.5 text-[11px] leading-snug rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 text-slate-700 dark:text-slate-300 shadow-xl pointer-events-none">
          Category counts are independent Gmail label statistics and may not sum to the Inbox total.
        </div>
      </div>
    </div>
  );
};
