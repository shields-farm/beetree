import { useState, useRef, useCallback } from 'react';
import { Camera, Video, Mic, MicOff, X, Image as ImageIcon } from 'lucide-react';

export interface MediaItem {
  id: string;
  type: 'photo' | 'video' | 'audio';
  dataUrl: string; // base64 data URL for localStorage
  timestamp: string;
  label?: string;
  duration?: number; // seconds for audio/video
}

interface MediaCaptureProps {
  media: MediaItem[];
  onAdd: (item: MediaItem) => void;
  onRemove: (id: string) => void;
}

function uid() {
  return `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MediaCapture({ media, onAdd, onRemove }: MediaCaptureProps) {
  const [recording, setRecording] = useState<'photo' | 'video' | 'audio' | null>(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const videoCaptureRef = useRef<HTMLInputElement>(null);
  const photoCaptureRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // ---- Photo: from gallery or live camera ----
  const handlePhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      onAdd({
        id: uid(),
        type: 'photo',
        dataUrl: reader.result as string,
        timestamp: new Date().toISOString(),
      });
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // reset for re-capture
  };

  // ---- Video: from gallery or live camera ----
  const handleVideoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // For video, create a data URL (could be large — warn for long videos)
    if (file.size > 20 * 1024 * 1024) {
      setError('Video is larger than 20MB — may not store reliably. Consider shorter clips.');
    }

    const reader = new FileReader();
    reader.onload = () => {
      // Get duration from a temporary video element
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        onAdd({
          id: uid(),
          type: 'video',
          dataUrl: reader.result as string,
          timestamp: new Date().toISOString(),
          duration: video.duration,
        });
      };
      video.src = reader.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  // ---- Voice note: live recording via MediaRecorder ----
  const startVoiceRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          onAdd({
            id: uid(),
            type: 'audio',
            dataUrl: reader.result as string,
            timestamp: new Date().toISOString(),
            duration: recordSeconds,
          });
        };
        reader.readAsDataURL(blob);

        // Cleanup
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (recordTimerRef.current) {
          clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
        setRecordSeconds(0);
        setRecording(null);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording('audio');
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      setError('Microphone permission denied. Enable mic access in your browser settings.');
      setRecording(null);
    }
  };

  const stopVoiceRecording = () => {
    mediaRecorderRef.current?.stop();
  };

  const cancelVoiceRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setRecordSeconds(0);
    setRecording(null);
    audioChunksRef.current = [];
  };

  // ---- Cleanup on unmount ----
  useCallback(() => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const photos = media.filter((m) => m.type === 'photo');
  const videos = media.filter((m) => m.type === 'video');
  const audios = media.filter((m) => m.type === 'audio');

  return (
    <div className="space-y-3">
      {/* Capture buttons */}
      <div className="grid grid-cols-3 gap-2">
        {/* Photo */}
        <div className="relative">
          <button
            type="button"
            onClick={() => photoCaptureRef.current?.click()}
            className="w-full py-3 rounded-xl bg-honey-50 border border-honey-200 text-honey-700 text-xs font-medium flex flex-col items-center gap-1 hover:bg-honey-100"
          >
            <Camera size={20} />
            Take Photo
          </button>
          <input
            ref={photoCaptureRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoFile}
            className="hidden"
          />
          {/* Also allow gallery pick */}
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="w-full mt-1 py-1.5 rounded-lg bg-stone-50 border border-stone-200 text-stone-500 text-[10px] flex items-center justify-center gap-1"
          >
            <ImageIcon size={11} /> Gallery
          </button>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            onChange={handlePhotoFile}
            className="hidden"
          />
        </div>

        {/* Video */}
        <div className="relative">
          <button
            type="button"
            onClick={() => videoCaptureRef.current?.click()}
            className="w-full py-3 rounded-xl bg-sky-50 border border-sky-200 text-sky-700 text-xs font-medium flex flex-col items-center gap-1 hover:bg-sky-100"
          >
            <Video size={20} />
            Record Video
          </button>
          <input
            ref={videoCaptureRef}
            type="file"
            accept="video/*"
            capture="environment"
            onChange={handleVideoFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            className="w-full mt-1 py-1.5 rounded-lg bg-stone-50 border border-stone-200 text-stone-500 text-[10px] flex items-center justify-center gap-1"
          >
            <ImageIcon size={11} /> Gallery
          </button>
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            onChange={handleVideoFile}
            className="hidden"
          />
        </div>

        {/* Voice note */}
        <div>
          {recording === 'audio' ? (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={stopVoiceRecording}
                className="w-full py-3 rounded-xl bg-red-500 text-white text-xs font-medium flex flex-col items-center gap-1 animate-pulse"
              >
                <MicOff size={20} />
                Stop ({formatDuration(recordSeconds)})
              </button>
              <button
                type="button"
                onClick={cancelVoiceRecording}
                className="w-full py-1.5 rounded-lg bg-stone-100 text-stone-500 text-[10px] flex items-center justify-center gap-1"
              >
                <X size={11} /> Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={startVoiceRecording}
              className="w-full py-3 rounded-xl bg-purple-50 border border-purple-200 text-purple-700 text-xs font-medium flex flex-col items-center gap-1 hover:bg-purple-100"
            >
              <Mic size={20} />
              Voice Note
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-red-500 px-1">{error}</p>}

      {/* Media previews */}
      {media.length > 0 && (
        <div className="space-y-3">
          {/* Photos grid */}
          {photos.length > 0 && (
            <div>
              <div className="text-xs text-stone-500 font-medium mb-1.5">Photos ({photos.length})</div>
              <div className="grid grid-cols-3 gap-2">
                {photos.map((p) => (
                  <div key={p.id} className="relative group rounded-lg overflow-hidden aspect-square">
                    <img src={p.dataUrl} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => onRemove(p.id)}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Videos */}
          {videos.length > 0 && (
            <div>
              <div className="text-xs text-stone-500 font-medium mb-1.5">Videos ({videos.length})</div>
              <div className="space-y-2">
                {videos.map((v) => (
                  <div key={v.id} className="relative rounded-lg overflow-hidden bg-stone-900">
                    <video src={v.dataUrl} controls className="w-full max-h-48" />
                    {v.duration && (
                      <span className="absolute top-1 left-1 text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">
                        {formatDuration(v.duration)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemove(v.id)}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Audio */}
          {audios.length > 0 && (
            <div>
              <div className="text-xs text-stone-500 font-medium mb-1.5">Voice Notes ({audios.length})</div>
              <div className="space-y-2">
                {audios.map((a) => (
                  <div key={a.id} className="flex items-center gap-2 rounded-lg bg-purple-50 border border-purple-100 p-2.5">
                    <Mic size={16} className="text-purple-600 shrink-0" />
                    <audio src={a.dataUrl} controls className="flex-1 h-8" />
                    {a.duration && (
                      <span className="text-[10px] text-stone-400">{formatDuration(a.duration)}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemove(a.id)}
                      className="w-6 h-6 rounded-full bg-stone-200 text-stone-500 flex items-center justify-center shrink-0"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}