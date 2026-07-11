import { useState, useEffect, useRef } from 'react';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import { A2uiSurface, basicCatalog } from '@a2ui/react/v0_9';

interface A2UIChatRendererProps {
  messages: any[];
}

const MessageProvider = MessageProcessor as any;

/**
 * Renders A2UI surfaces from agent messages.
 * Used alongside text chat to show rich interactive UIs.
 * Wrapped in error boundary by parent — all operations are try/catch guarded.
 */
export function A2UIChatRenderer({ messages }: A2UIChatRendererProps) {
  const processorRef = useRef<any>(null);
  const [surfaces, setSurfaces] = useState<any[]>([]);
  const [failed, setFailed] = useState(false);

  if (!processorRef.current && !failed) {
    try {
      processorRef.current = new MessageProvider([basicCatalog]);
    } catch (e) {
      console.error('[A2UI] Failed to create processor:', e);
      setFailed(true);
    }
  }

  useEffect(() => {
    if (failed || !processorRef.current) return;
    const processor = processorRef.current;
    try {
      const sync = () => {
        try {
          setSurfaces(Array.from(processor.model.surfacesMap.values()));
        } catch (e) {
          console.error('[A2UI] sync error:', e);
        }
      };
      const createdSub = processor.onSurfaceCreated(sync);
      const deletedSub = processor.onSurfaceDeleted(sync);
      return () => {
        try { createdSub.unsubscribe(); } catch {}
        try { deletedSub.unsubscribe(); } catch {}
      };
    } catch (e) {
      console.error('[A2UI] effect error:', e);
    }
  }, [failed]);

  useEffect(() => {
    if (failed || !processorRef.current) return;
    if (messages && messages.length > 0) {
      try {
        processorRef.current.processMessages(messages);
      } catch (e) {
        console.error('[A2UI] processMessages error:', e);
        setFailed(true);
      }
    }
  }, [messages, failed]);

  if (failed || surfaces.length === 0) return null;

  try {
    return (
      <div className="a2ui-container space-y-3">
        {surfaces.map((surface) => (
          <A2uiSurface key={surface.id} surface={surface} />
        ))}
      </div>
    );
  } catch (e) {
    console.error('[A2UI] render error:', e);
    return null;
  }
}
