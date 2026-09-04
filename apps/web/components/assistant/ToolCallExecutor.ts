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
      break;
    }

    case 'search_emails':
    case 'apply_filters': {
      // Extract filter criteria
      const criteria: Partial<FilterCriteria> = {
        sender: args.sender || undefined,
        keyword: args.keyword || undefined,
        date_from: args.date_from || undefined,
        date_to: args.date_to || undefined,
        unread_only: args.unread_only !== undefined ? Boolean(args.unread_only) : undefined,
        folder: args.folder || 'inbox',
      };

      store.setView(criteria.folder === 'sent' ? 'sent' : 'inbox');
      if (toolCall.result?.emails && Array.isArray(toolCall.result.emails) && toolCall.result.emails.length > 0) {
        store.setEmails(toolCall.result.emails);
      }
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
      const draft = store.composeDraft;
      store.openConfirmModal({
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
        thread_id: draft.thread_id,
      });
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
