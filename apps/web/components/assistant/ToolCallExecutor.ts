import { ToolCall, Email, FilterCriteria } from '../../lib/types';
import { useMailStore } from '../../lib/store';

// Staggered typing simulator for smooth copilot UI effect (40-60ms per char)
async function animateFieldTyping(
  targetText: string,
  onUpdate: (current: string) => void,
  charDelay: number = 40
): Promise<void> {
  let current = '';
  for (let i = 0; i < targetText.length; i++) {
    current += targetText[i];
    onUpdate(current);
    await new Promise((res) => setTimeout(res, charDelay));
  }
}

export async function executeAssistantToolCall(toolCall: ToolCall): Promise<void> {
  const store = useMailStore.getState();
  const { name, arguments: args } = toolCall;

  console.log(`[ToolCallExecutor] Executing ${name}:`, args);

  switch (name) {
    case 'draft_compose':
    case 'open_compose': {
      // 1. Switch view to compose immediately
      store.setView('compose');
      store.setIsTypingCompose(true);
      store.resetComposeDraft();
      store.setComposeDraft({
        draft_id: args.draft_id || undefined,
        reply_to_id: args.reply_to_id || undefined,
        thread_id: args.thread_id || undefined,
      });

      const to = args.to || '';
      const subject = args.subject || '';
      const body = args.body || '';

      // 2. Animate To field typing
      if (to) {
        await animateFieldTyping(to, (val) => {
          useMailStore.getState().setComposeDraft({ to: val });
        }, 30);
      }

      // Small pause between fields
      await new Promise((res) => setTimeout(res, 120));

      // 3. Animate Subject field typing
      if (subject) {
        await animateFieldTyping(subject, (val) => {
          useMailStore.getState().setComposeDraft({ subject: val });
        }, 35);
      }

      // Small pause between fields
      await new Promise((res) => setTimeout(res, 150));

      // 4. Animate Body typing
      if (body) {
        await animateFieldTyping(body, (val) => {
          useMailStore.getState().setComposeDraft({ body: val });
        }, 20);
      }

      useMailStore.getState().setIsTypingCompose(false);

      if (useMailStore.getState().sendMode === 'automatic' && name === 'draft_compose') {
        await new Promise((res) => setTimeout(res, 800));
        useMailStore.getState().resetComposeDraft();
        useMailStore.getState().setView('sent');
      }
      break;
    }

    case 'search_emails': {
      const folder = args.folder === 'sent' ? 'sent' : 'inbox';
      store.setView(folder);

      const criteria: Partial<FilterCriteria> = {
        sender: args.sender || undefined,
        keyword: args.keyword || undefined,
        date_from: args.date_from || undefined,
        date_to: args.date_to || undefined,
        unread_only: args.unread_only !== undefined ? Boolean(args.unread_only) : undefined,
        folder,
      };

      // Reset stale filters first so new search doesn't inherit leftover dates/senders (Section 16)
      store.resetFilters();
      store.setFilters(criteria);

      // Construct literal search query for Gmail (inclusive before: date)
      const parts: string[] = [];
      if (args.sender) parts.push(`from:${args.sender}`);
      if (args.keyword) parts.push(args.keyword);
      if (args.unread_only) parts.push('is:unread');
      if (args.date_from) parts.push(`after:${args.date_from}`);
      if (args.date_to) {
        try {
          const p = args.date_to.split('-').map(Number);
          if (p.length === 3) {
            const nextDate = new Date(p[0], p[1] - 1, p[2] + 1);
            const y = nextDate.getFullYear();
            const m = String(nextDate.getMonth() + 1).padStart(2, '0');
            const d = String(nextDate.getDate()).padStart(2, '0');
            parts.push(`before:${y}-${m}-${d}`);
          } else {
            parts.push(`before:${args.date_to}`);
          }
        } catch {
          parts.push(`before:${args.date_to}`);
        }
      }
      const queryDesc = parts.join(' ') || 'Mailbox Search';

      if (toolCall.result?.emails && Array.isArray(toolCall.result.emails)) {
        const emails = toolCall.result.emails;
        const estimate = toolCall.result.result_size_estimate ?? toolCall.result.count ?? emails.length;
        const nextToken = toolCall.result.next_page_token || null;
        store.setSearchResults(emails, queryDesc, estimate, nextToken);
      } else {
        // Fallback: Query backend directly using the constructed Gmail query
        const apiUrl = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';
        store.setLoadingEmails(true);
        try {
          const res = await fetch(`${apiUrl}/emails/list?folder=${folder}&q=${encodeURIComponent(queryDesc)}&limit=25`);
          if (res.ok) {
            const data = await res.json();
            store.setSearchResults(
              data.emails || [],
              queryDesc,
              data.result_size_estimate ?? data.count ?? (data.emails ? data.emails.length : 0),
              data.next_page_token || null
            );
          }
        } catch (err) {
          console.error('Failed to retrieve search results in ToolCallExecutor:', err);
        } finally {
          store.setLoadingEmails(false);
        }
      }
      break;
    }

    case 'apply_filters': {
      const c = args.criteria || args;
      const criteria: Partial<FilterCriteria> = {
        sender: c.sender || undefined,
        keyword: c.keyword || undefined,
        date_from: c.date_from || undefined,
        date_to: c.date_to || undefined,
        unread_only: c.unread_only !== undefined ? Boolean(c.unread_only) : undefined,
        folder: c.folder || 'inbox',
      };

      store.setView(criteria.folder === 'sent' ? 'sent' : 'inbox');
      store.setFilters(criteria);
      break;
    }

    case 'open_email': {
      const emailId = args.email_id;
      if (!emailId) break;

      const foundEmail = store.emails.find((e: Email) => e.id === emailId);
      if (foundEmail) {
        store.setOpenEmail(foundEmail);
      } else {
        // Fetch specific email from backend if not yet in state
        const apiUrl = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';
        try {
          const res = await fetch(`${apiUrl}/emails/${emailId}`);
          if (res.ok) {
            const data = await res.json();
            store.setOpenEmail(data);
          }
        } catch (e) {
          console.error('Failed to open email by id:', e);
        }
      }
      break;
    }

    case 'prepare_send': {
      // Strictly use literal payload from args to prevent stale/resurrected fields
      const draft_id = args.draft_id || ('draft-' + Date.now());
      const to = args.to !== undefined ? args.to : '';
      const subject = args.subject !== undefined ? args.subject : '';
      const body = args.body !== undefined ? args.body : '';
      const thread_id = args.thread_id || undefined;
      const reply_to_id = args.reply_to_id || undefined;

      const freshDraft = { draft_id, to, subject, body, thread_id, reply_to_id };

      // In automatic send mode, dispatch immediately without opening review modal
      if (store.sendMode === 'automatic') {
        const apiUrl = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://localhost:8000';
        try {
          await fetch(`${apiUrl}/emails/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(freshDraft),
          });
          store.resetComposeDraft();
          store.setView('sent');
        } catch (e) {
          console.error('Automatic send failed, opening confirmation modal as fallback:', e);
          store.setComposeDraft(freshDraft);
          store.openConfirmModal(freshDraft);
        }
        break;
      }

      // Update composeDraft directly to guarantee zero drift
      store.setComposeDraft(freshDraft);
      store.openConfirmModal(freshDraft);
      break;
    }

    case 'send_auto_dispatched': {
      store.resetComposeDraft();
      store.setView('sent');
      break;
    }

    case 'fill_form': {
      const emailId = args.email_id;
      let targetEmail = store.openEmail;
      if (emailId && (!targetEmail || targetEmail.id !== emailId)) {
        targetEmail = store.emails.find((e: Email) => e.id === emailId) || null;
      }
      if (!targetEmail && store.emails.length > 0) {
        targetEmail = store.emails[0];
      }
      if (targetEmail) {
        store.openFormModal(targetEmail);
      }
      break;
    }

    case 'list_recent': {
      const folder = args.folder || 'inbox';
      store.setView(folder === 'sent' ? 'sent' : 'inbox');
      store.resetFilters();
      break;
    }

    default:
      console.warn(`Unhandled assistant tool call: ${name}`);
  }
}
