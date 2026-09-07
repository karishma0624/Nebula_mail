import { UIContext, ToolCall, Citation } from './types';
import { authFetch, AGENT_API_URL } from './api';

interface StreamChatOptions {
  message: string;
  uiContext: UIContext;
  conversationId?: string | null;
  onConversation?: (data: { conversation_id: string; title?: string }) => void;
  onCitations?: (citations: Citation[]) => void;
  onToolCall: (toolCall: ToolCall) => void;
  onMessageDelta: (delta: string) => void;
  onError: (error: string) => void;
  onDone: () => void;
}

export async function streamChatAssistant({
  message,
  uiContext,
  conversationId,
  onConversation,
  onCitations,
  onToolCall,
  onMessageDelta,
  onError,
  onDone,
}: StreamChatOptions): Promise<() => void> {
  const controller = new AbortController();

  try {
    const response = await authFetch(`${AGENT_API_URL}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        message,
        ui_context: uiContext,
        conversation_id: conversationId || undefined,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Chat API error: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('ReadableStream not supported by response');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = 'message';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith('event:')) {
              currentEvent = trimmed.replace('event:', '').trim();
            } else if (trimmed.startsWith('data:')) {
              const dataStr = trimmed.replace('data:', '').trim();
              if (dataStr === '[DONE]') {
                continue;
              }

              try {
                const parsed = JSON.parse(dataStr);
                if (currentEvent === 'conversation' || parsed.event === 'conversation') {
                  onConversation?.(parsed.data || parsed);
                } else if (currentEvent === 'citations' || parsed.event === 'citations') {
                  onCitations?.(parsed.citations || parsed.data?.citations || parsed);
                } else if (currentEvent === 'tool_call' || parsed.event === 'tool_call') {
                  onToolCall(parsed.data || parsed);
                } else if (currentEvent === 'message' || parsed.event === 'message') {
                  onMessageDelta(parsed.delta || parsed.content || parsed.text || '');
                } else if (currentEvent === 'error' || parsed.event === 'error') {
                  onError(parsed.error || 'Agent stream error');
                }
              } catch {
                // Raw text chunk fallback
                if (currentEvent === 'message') {
                  onMessageDelta(dataStr);
                }
              }
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          onError(err.message || 'Stream reading error');
        }
      } finally {
        onDone();
      }
    })();
  } catch (error: any) {
    if (error.name !== 'AbortError') {
      onError(error.message || 'Failed to connect to assistant stream');
      onDone();
    }
  }

  return () => controller.abort();
}
