import React, { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { MapPin, Search, X } from 'lucide-react';
import { isInsideChandigarh } from '../data/tricityPlaces';
import type { NamedLocation } from '../types/run';

interface PlaceSearchInputProps {
  value: string;
  placeholder?: string;
  onSelect: (loc: NamedLocation) => void;
}

const EXCLUDED_OUTSIDE_CITIES = /\b(mohali|panchkula|zirakpur|kharar|sahibzada ajit singh|derabassi|pinjore|kalka|new chandigarh|mullanpur)\b/i;

export const PlaceSearchInput: React.FC<PlaceSearchInputProps> = ({
  value,
  placeholder = 'Search sector, park, or landmark in Chandigarh...',
  onSelect,
}) => {
  const placesLib = useMapsLibrary('places');
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [boundsError, setBoundsError] = useState<string | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    if (!placesLib || !isOpen) return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new placesLib.AutocompleteSessionToken();
        }
        setLoading(true);
        const res = await placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: `${trimmed}, Chandigarh`,
          sessionToken: sessionTokenRef.current,
          locationRestriction: {
            south: 30.6845,
            west: 76.725,
            north: 30.7695,
            east: 76.842,
          },
          includedRegionCodes: ['in'],
        });
        const filtered = (res.suggestions || []).filter(
          (s) => !EXCLUDED_OUTSIDE_CITIES.test(s.placePrediction?.text?.text || '')
        );
        setSuggestions(filtered);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('OVER_QUERY_LIMIT')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 260);

    return () => clearTimeout(timer);
  }, [placesLib, query, isOpen]);

  const handlePick = async (suggestion: google.maps.places.AutocompleteSuggestion) => {
    if (!suggestion.placePrediction) return;
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
      if (place.location) {
        const pickedPt = { lat: place.location.lat(), lng: place.location.lng() };
        const addr = place.formattedAddress || '';
        if (!isInsideChandigarh(pickedPt) || EXCLUDED_OUTSIDE_CITIES.test(addr)) {
          setBoundsError('Only Chandigarh UT locations are supported (Mohali, Panchkula, Zirakpur & Kharar are excluded).');
          setIsOpen(false);
          return;
        }
        setBoundsError(null);
        const name =
          place.displayName ||
          suggestion.placePrediction.text?.text ||
          'Selected Location';
        setQuery(name);
        setIsOpen(false);
        setSuggestions([]);
        sessionTokenRef.current = null;
        onSelect({
          name,
          city: 'Chandigarh',
          ...pickedPt,
        });
      }
    } catch {
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <div className="flex min-h-[44px] items-center rounded-xl border border-[#D9D7CE] bg-white px-3 focus-within:border-[#172D27]">
        <Search className="mr-2 h-4 w-4 shrink-0 text-[#5B6B64]" />
        <input
          type="text"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setBoundsError(null);
            setIsOpen(true);
          }}
          placeholder={placeholder}
          className="w-full bg-transparent text-sm text-[#141F1B] placeholder:text-[#5B6B64]/70 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear location search"
            onClick={() => {
              setQuery('');
              setBoundsError(null);
              setSuggestions([]);
            }}
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-[#5B6B64] hover:bg-[#F6F5F0]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {boundsError && (
        <p className="mt-1 text-[11px] font-medium text-amber-800">{boundsError}</p>
      )}

      {isOpen && (suggestions.length > 0 || loading) && (
        <ul className="absolute z-30 mt-1.5 max-h-60 w-full overflow-y-auto rounded-xl border border-[#E5E3DC] bg-white py-1 shadow-lg">
          {loading && suggestions.length === 0 && (
            <li className="px-3 py-2.5 text-xs text-[#5B6B64]">Searching Chandigarh places...</li>
          )}
          {suggestions.map((item, idx) => (
            <li key={idx}>
              <button
                type="button"
                onClick={() => handlePick(item)}
                className="flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[#141F1B] hover:bg-[#F6F5F0]"
              >
                <MapPin className="h-4 w-4 shrink-0 text-[#30483E]" />
                <span className="truncate">{item.placePrediction?.text.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
