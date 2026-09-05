'use client';

import React from 'react';

interface HighlightedTextProps {
  text: string;
  query?: string;
  terms?: string[];
  className?: string;
}

/**
 * Reusable keyword highlight component matching Gmail's soft yellow/amber highlighting.
 * Theme-aware: soft yellow on light backgrounds, muted amber/gold on dark backgrounds.
 * Splits and wraps matched substrings using proper React elements (zero dangerouslySetInnerHTML / zero XSS risk).
 */
export const HighlightedText: React.FC<HighlightedTextProps> = ({
  text,
  query,
  terms,
  className = ''
}) => {
  if (!text) return null;

  // Build array of raw terms from both `terms` prop and `query` prop
  const searchTerms: string[] = [];
  if (terms && Array.isArray(terms)) {
    searchTerms.push(...terms);
  }
  if (query && typeof query === 'string') {
    // Extract tokens from query string
    const tokens = query.split(/\s+/);
    searchTerms.push(...tokens);
  }

  // Clean and filter valid search terms (minimum 2 chars, strip Gmail operator prefixes)
  const validTerms = Array.from(new Set(
    searchTerms
      .map(t => t.trim().replace(/^(from|to|subject|label|after|before|category):/i, '').replace(/['"]/g, ''))
      .filter(t => t.length >= 2)
  )).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (validTerms.length === 0) {
    return <span className={className}>{text}</span>;
  }

  try {
    const regex = new RegExp(`(${validTerms.join('|')})`, 'gi');
    const parts = text.split(regex);

    return (
      <span className={className}>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <mark
              key={i}
              className="bg-[#ffdf70] dark:bg-amber-400/30 text-slate-900 dark:text-amber-200 font-semibold px-0.5 rounded-[2px] transition-colors"
            >
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </span>
    );
  } catch {
    return <span className={className}>{text}</span>;
  }
};
