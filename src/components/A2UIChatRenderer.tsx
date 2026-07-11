import { useState, useEffect, useRef } from 'react';
import { MessageProcessor } from '@a2ui/web_core/v0_9';
import { A2uiSurface, basicCatalog } from '@a2ui/react/v0_9';

interface A2UIChatRendererProps {
  messages: any[];
}

/**
 * Renders A2UI surfaces from agent messages.
 * Used alongside text chat to show rich interactive UIs.
 */
export function A2UIChatRenderer({ messages }: A2UIChatRendererProps) {
  const processorRef = useRef<any>(null);
  const [surfaces, setSurfaces] = useState<any[]>([]);

  if (!processorRef.current) {
    processorRef.current = new (MessageProvider as any)([basicCatalog]);
  }

  useEffect(() => {
    const processor = processorRef.current;
    const sync = () => setSurfaces(Array.from(processor.model.surfacesMap.values()));
    const createdSub = processor.onSurfaceCreated(sync);
    const deletedSub = processor.onSurfaceDeleted(sync);
    return () => {
      createdSub.unsubscribe();
      deletedSub.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (messages && messages.length > 0) {
      processorRef.current?.processMessages(messages);
    }
  }, [messages]);

  if (surfaces.length === 0) return null;

  return (
    <div className="a2ui-container space-y-3">
      {surfaces.map((surface) => (
        <A2uiSurface key={surface.id} surface={surface} />
      ))}
    </div>
  );
}

// Work around generic type requirement
const MessageProvider = MessageProcessor as any;
