import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, ExternalLink, Image as ImageIcon, Share2, X } from 'lucide-react';
import {
  copyPngBlobToClipboard,
  copyShareText,
  prepareShareCardSync,
  SHARE_CARD_STYLES,
  triggerPngDownload,
  tryNativeSharePreparedCard,
  type PreparedShareCard,
  type ShareCardStyle,
} from '../services/shareCardService';

interface ShareCardModalProps {
  card: PreparedShareCard | null;
  onClose: () => void;
}

export const ShareCardModal: React.FC<ShareCardModalProps> = ({ card, onClose }) => {
  const [selectedStyle, setSelectedStyle] = useState<ShareCardStyle>('route');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (card) {
      setSelectedStyle(card.style || card.sourceInput?.style || 'route');
      setStatusMsg(null);
    }
  }, [card]);

  const availableStyles = useMemo(() => {
    if (!card?.sourceInput) return [];
    const hasRunMetrics =
      card.sourceInput.splits !== undefined || card.sourceInput.durationSec !== undefined;
    if (hasRunMetrics) return SHARE_CARD_STYLES;
    return SHARE_CARD_STYLES.filter((s) => s.id === 'route' || s.id === 'adidas_poster');
  }, [card]);

  const activeCard = useMemo(() => {
    if (!card) return null;
    if (!card.sourceInput || selectedStyle === card.style) {
      return card;
    }
    const baseName = card.filename.replace(/-(splits|adidas_poster|pace_chart)\.png$/i, '.png');
    return (
      prepareShareCardSync({
        filename: baseName,
        shareTitle: card.shareTitle,
        shareText: card.shareText,
        card: {
          ...card.sourceInput,
          style: selectedStyle,
        },
      }) || card
    );
  }, [card, selectedStyle]);

  if (!card || !activeCard) return null;

  const canAttemptNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleNativeShare = async () => {
    const res = await tryNativeSharePreparedCard(activeCard);
    if (res === 'shared_file') {
      setStatusMsg('Shared PNG card successfully.');
    } else if (res === 'unsupported' || res === 'failed') {
      setStatusMsg(
        'Direct OS file sharing is unavailable here. Use Save PNG or Copy PNG below, then attach into WhatsApp.'
      );
    }
  };

  const handleDownload = () => {
    const objectUrl = URL.createObjectURL(activeCard.blob);
    triggerPngDownload(objectUrl, activeCard.filename);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    setStatusMsg(`Saved ${SHARE_CARD_STYLES.find((s) => s.id === selectedStyle)?.label || 'PNG'} card.`);
  };

  const handleCopyImage = async () => {
    const ok = await copyPngBlobToClipboard(activeCard.blob);
    if (ok) {
      setStatusMsg('PNG image copied! Paste it directly into WhatsApp Web or any chat.');
    } else {
      setStatusMsg('Image clipboard copy is not supported on this browser — use Save PNG instead.');
    }
  };

  const handleCopyText = async () => {
    const ok = await copyShareText(activeCard.shareText);
    if (ok) {
      setStatusMsg('Run summary caption copied to clipboard.');
    }
  };

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(activeCard.shareText)}`;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[94dvh] overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#30483E]">
              PNG Card Studio
            </p>
            <h3 className="truncate font-display text-lg font-bold text-[#141F1B]">
              {activeCard.shareTitle}
            </h3>
          </div>
          <button
            type="button"
            aria-label="Close share modal"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[#5B6B64] hover:bg-[#F6F5F0]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Multi-Type Card Style Switcher */}
        {availableStyles.length > 1 && (
          <div className="grid grid-cols-4 gap-1 rounded-xl border border-[#E5E3DC] bg-[#F6F5F0] p-1">
            {availableStyles.map((st) => {
              const active = selectedStyle === st.id;
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => {
                    setSelectedStyle(st.id);
                    setStatusMsg(null);
                  }}
                  className={`min-h-[40px] rounded-lg px-1.5 text-[11px] font-bold transition whitespace-nowrap ${
                    active
                      ? 'bg-[#172D27] text-[#9AE62E] shadow-sm'
                      : 'text-[#5B6B64] hover:text-[#141F1B]'
                  }`}
                >
                  {st.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-[#E5E3DC] bg-[#111D19]">
          <img
            src={activeCard.dataUrl}
            alt={`${activeCard.shareTitle} (${selectedStyle})`}
            className="mx-auto block w-full max-w-[360px] object-contain"
          />
        </div>

        <p className="text-[11px] leading-relaxed text-[#5B6B64]">
          Switch between Route Map, KM Splits Pace, Run Poster, and Pace Chart above — then share or save the active PNG.
        </p>

        {statusMsg && (
          <div className="flex items-start gap-2 rounded-xl border border-[#30483E]/30 bg-[#EBF5EE] px-3.5 py-2.5 text-xs font-medium text-[#172D27]">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#172D27]" />
            <span>{statusMsg}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          {canAttemptNativeShare && (
            <button
              type="button"
              onClick={() => void handleNativeShare()}
              className="col-span-2 flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-[#172D27] px-4 text-xs font-bold text-[#9AE62E]"
            >
              <Share2 className="h-4 w-4" />
              Share PNG via System Sheet
            </button>
          )}

          <button
            type="button"
            onClick={handleDownload}
            className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold ${
              canAttemptNativeShare
                ? 'border border-[#D9D7CE] bg-white text-[#141F1B]'
                : 'col-span-2 bg-[#172D27] text-[#9AE62E]'
            }`}
          >
            <Download className="h-4 w-4" />
            Save PNG
          </button>

          <button
            type="button"
            onClick={() => void handleCopyImage()}
            className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#D9D7CE] bg-white px-4 text-xs font-semibold text-[#141F1B]"
          >
            <ImageIcon className="h-4 w-4" />
            Copy PNG
          </button>

          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[#30483E]/30 bg-[#EBF5EE] px-4 text-xs font-semibold text-[#172D27]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            WhatsApp
          </a>

          <button
            type="button"
            onClick={() => void handleCopyText()}
            className="col-span-2 flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl bg-[#F6F5F0] px-4 text-xs font-semibold text-[#5B6B64] hover:text-[#141F1B]"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy Run Summary Text
          </button>
        </div>
      </div>
    </div>
  );
};
