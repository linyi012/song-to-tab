import { useCallback, useEffect, useRef, useState } from "react";
import { IconPause, IconPlay, IconStop } from "./TransportIcons";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface SourceAudioPlayerProps {
  src: string | null;
  label?: string;
}

export default function SourceAudioPlayer({ src, label }: SourceAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
  }, [src]);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (audio.paused) {
      try {
        await audio.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [src]);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setCurrentTime(0);
    setIsPlaying(false);
  }, []);

  const seek = useCallback((sec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = sec;
    setCurrentTime(sec);
  }, []);

  if (!src) return null;

  return (
    <div className="source-audio">
      {label && <div className="source-audio-label">{label}</div>}
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={() => {
          const audio = audioRef.current;
          if (audio) setDuration(audio.duration);
        }}
        onTimeUpdate={() => {
          const audio = audioRef.current;
          if (audio) setCurrentTime(audio.currentTime);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(duration);
        }}
      />
      <div className="transport source-audio-transport">
        <button
          className={`transport-btn play ${isPlaying ? "playing" : ""}`}
          type="button"
          onClick={() => void togglePlay()}
          title={isPlaying ? "暂停" : "播放"}
          aria-label={isPlaying ? "暂停" : "播放"}
        >
          {isPlaying ? (
            <IconPause className="transport-icon" />
          ) : (
            <IconPlay className="transport-icon" />
          )}
        </button>
        <button
          className="transport-btn"
          type="button"
          onClick={stop}
          title="停止"
          aria-label="停止"
        >
          <IconStop className="transport-icon" />
        </button>
        <input
          className="transport-seek"
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={Math.min(currentTime, duration || 0)}
          disabled={!duration}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className="transport-time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
    </div>
  );
}

/** 将 base64 WAV 转为 blob URL；调用方负责 revoke。 */
export function base64ToAudioUrl(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}
