import React, { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Globe, MapPin, Search, X } from 'lucide-react';
import {
  getCityLatLngBounds,
  isInsideSelectedCity,
  type ActiveRunningCity,
} from '../data/worldCities';
import type { LatLngLiteral, NamedLocation } from '../types/run';

interface PlaceSearchInputProps {
  value: string;
  placeholder?: string;
  mode?: 'place' | 'city';
  biasCenter?: LatLngLiteral;
  biasCityName?: string;
  strictCity?: ActiveRunningCity;
  onSelect: (loc: NamedLocation) => void;
}

function extractCityName(
  place: google.maps.places.Place,
  fallbackCity?: string
): string {
  const components = place.addressComponents || [];
  const locality = components.find((c) => c.types?.includes('locality'));
  if (locality?.longText || locality?.shortText) {
    return locality.longText || locality.shortText || fallbackCity || 'World';
  }
  const admin2 = components.find((c) => c.types?.includes('administrative_area_level_2'));
  if (admin2?.longText) return admin2.longText;
  const admin1 = components.find((c) => c.types?.includes('administrative_area_level_1'));
  if (admin1?.longText) return admin1.longText;
  if (place.displayName) return place.displayName;
  if (place.formattedAddress) {
    const firstPart = place.formattedAddress.split(',')[0]?.trim();
    if (firstPart) return firstPart;
  }
  return fallbackCity || 'World';
}

export const PlaceSearchInput: React.FC<PlaceSearchInputProps> = ({
  value,
  placeholder,
  mode = 'place',
  biasCenter,
  biasCityName,
  strictCity,
  onSelect,
}) => {
  const placesLib = useMapsLibrary('places');
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  const activeCityLabel = strictCity?.name || biasCityName;
  const resolvedPlaceholder =
    placeholder ||
    (mode === 'city'
      ? 'Search any city worldwide (e.g. Tokyo, London, New York)...'
      : strictCity
      ? `Search parks, streets, or landmarks inside ${strictCity.name}...`
      : activeCityLabel
      ? `Search parks, streets, or landmarks in ${activeCityLabel} or worldwide...`
      : 'Search any park, street, or city worldwide...');

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
        setSearchError(null);

        const request: google.maps.places.AutocompleteRequest = {
          input: trimmed,
          sessionToken: sessionTokenRef.current,
        };

        if (mode === 'city') {
          request.includedPrimaryTypes = ['(cities)'];
        } else if (strictCity) {
          request.locationRestriction = getCityLatLngBounds(strictCity);
        } else if (biasCenter) {
          request.locationBias = {
            center: biasCenter,
            radius: 30000,
          };
        }

        const res = await placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
        setSuggestions(res.suggestions || []);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('OVER_QUERY_LIMIT')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        setSearchError('Unable to fetch place suggestions right now.');
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 260);

    return () => clearTimeout(timer);
  }, [placesLib, query, isOpen, mode, biasCenter, strictCity]);

  const handlePick = async (suggestion: google.maps.places.AutocompleteSuggestion) => {
    if (!suggestion.placePrediction) return;
    try {
      const place = suggestion.placePrediction.toPlace();
      await place.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location', 'addressComponents'],
      });
      if (place.location) {
        const pickedPt = { lat: place.location.lat(), lng: place.location.lng() };
        const city =
          mode === 'city'
            ? place.displayName || extractCityName(place, activeCityLabel)
            : extractCityName(place, activeCityLabel);
        const name =
          mode === 'city'
            ? city
            : place.displayName || suggestion.placePrediction.text?.text || 'Selected Location';

        if (mode !== 'city' && strictCity && !isInsideSelectedCity(pickedPt, strictCity)) {
          setSearchError(
            `${name} is outside your selected Running City (${strictCity.name}). Pick a location inside ${strictCity.name} or change Running City in Profile.`
          );
          setIsOpen(false);
          setSuggestions([]);
          sessionTokenRef.current = null;
          return;
        }

        setSearchError(null);
        setQuery(name);
        setIsOpen(false);
        setSuggestions([]);
        sessionTokenRef.current = null;
        onSelect({
          name,
          city: strictCity ? strictCity.name : city,
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
        {mode === 'city' ? (
          <Globe className="mr-2 h-4 w-4 shrink-0 text-[#5B6B64]" />
        ) : (
          <Search className="mr-2 h-4 w-4 shrink-0 text-[#5B6B64]" />
        )}
        <input
          type="text"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearchError(null);
            setIsOpen(true);
          }}
          placeholder={resolvedPlaceholder}
          className="w-full bg-transparent text-sm text-[#141F1B] placeholder:text-[#5B6B64]/70 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear location search"
            onClick={() => {
              setQuery('');
              setSearchError(null);
              setSuggestions([]);
            }}
            className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-[#5B6B64] hover:bg-[#F6F5F0]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {searchError && (
        <p className="mt-1 text-[11px] font-medium text-amber-800">{searchError}</p>
      )}

      {isOpen && (suggestions.length > 0 || loading) && (
        <ul className="absolute z-30 mt-1.5 max-h-60 w-full overflow-y-auto rounded-xl border border-[#E5E3DC] bg-white py-1 shadow-lg">
          {loading && suggestions.length === 0 && (
            <li className="px-3 py-2.5 text-xs text-[#5B6B64]">
              {mode === 'city' ? 'Searching world cities...' : 'Searching places worldwide...'}
            </li>
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
