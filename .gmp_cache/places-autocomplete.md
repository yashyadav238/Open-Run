# Return Autocomplete Results About Places Based on a Query String

Autocomplete (New) is a REST web service that returns place predictions and
query predictions in response to an HTTP POST request. Applications send queries
as the user types to provide on-the-fly place (businesses, addresses, points of
interest, plus codes) and query predictions.

## Endpoint & Authentication

### Endpoint

```http
POST https://places.googleapis.com/v1/places:autocomplete
```

### Required Headers

-   `Content-Type: application/json`
-   `X-Goog-Api-Key: YOUR_API_KEY`
-   `X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1` (Required for usage
    attribution)

### Optional Headers

-   `X-Goog-FieldMask`: Comma-separated list specifying which fields to return
    in the response (no spaces allowed). Use `*` to retrieve all fields, or
    specify exact paths such as
    `suggestions.placePrediction.text.text,suggestions.placePrediction.placeId`.

--------------------------------------------------------------------------------

## Request Parameters

Pass parameters in the JSON request body.

### Required Parameters

-   `input` (string): The text string on which to search (full words,
    substrings, place names, addresses, or plus codes).

### Optional Parameters

-   `locationBias` (object): Specifies an area to bias search results towards
    (results outside the area can still be returned). **Cannot be used with
    `locationRestriction`**. If both are omitted, the API defaults to IP
    biasing. Defined as a `circle` or `rectangle`:
    -   `circle`: `{ "center": { "latitude": number, "longitude": number },
        "radius": number }` (Radius in meters, between `0.0` and `50000.0`).
    -   `rectangle`: `{ "low": { "latitude": number, "longitude": number },
        "high": { "latitude": number, "longitude": number } }`.
-   `locationRestriction` (object): Specifies an area to strictly restrict
    search results within (results outside the area are excluded). **Cannot be
    used with `locationBias`**. Uses the same `circle` (radius must be `> 0.0`)
    or `rectangle` structure as `locationBias`.
-   `includedPrimaryTypes` (array of strings): Restricts results to places
    matching up to 5 specified primary types from
    [Table A](https://developers.google.com/maps/documentation/places/web-service/place-types#table-a)
    or
    [Table B](https://developers.google.com/maps/documentation/places/web-service/place-types#table-b),
    OR a single collection type of either `"(regions)"` or `"(cities)"`.
    -   *Constraint*: Request fails with `INVALID_REQUEST` if more than 5 types
        are specified, if any other type is combined with `"(cities)"` or
        `"(regions)"`, or if unrecognized types are provided.
-   `includedRegionCodes` (array of strings): Up to 15 two-character ccTLD
    country codes (e.g., `["de", "fr"]`) to restrict results to.
    -   *Constraint*: Query predictions are not returned when
        `includedRegionCodes` is set.
-   `includeQueryPredictions` (boolean): If `true`, includes both
    `placePrediction` and `queryPrediction` items in the response (up to 5 total
    predictions combined). Defaults to `false` (returns up to 5
    `placePrediction` items).
-   `includePureServiceAreaBusinesses` (boolean): If `true`, includes businesses
    that visit or deliver to customers directly without a physical location.
    Defaults to `false`.
-   `includeFutureOpeningBusinesses` (boolean): If `true`, returns businesses
    expected to open in the future. Defaults to `false`.
-   `inputOffset` (integer): Zero-based Unicode character offset indicating the
    cursor position in `input`. Defaults to the length of `input`.
-   `languageCode` (string): Preferred IETF BCP-47 language code for results.
    Defaults to the `Accept-Language` header or `"en"`.
-   `origin` (object): `{ "latitude": number, "longitude": number }`. Origin
    point used to calculate straight-line distance (`distanceMeters`) to each
    predicted destination in the response.
-   `regionCode` (string): Two-character ccTLD value (e.g., `"uk"`, `"us"`) used
    to format the response and bias suggestions.
-   `sessionToken` (string): User-generated string to group Autocomplete calls
    and a subsequent Place Details call into a discrete session for billing
    purposes.

--------------------------------------------------------------------------------

## Code Examples

### 1. Basic Request with Location Bias (Circle)

Bias results toward a 500-meter radius in San Francisco:

```bash
curl -X POST -d '{
  "input": "pizza",
  "locationBias": {
    "circle": {
      "center": {
        "latitude": 37.7937,
        "longitude": -122.3965
      },
      "radius": 500.0
    }
  }
}' \
-H 'Content-Type: application/json' \
-H 'X-Goog-Api-Key: YOUR_API_KEY' \
-H 'X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1' \
https://places.googleapis.com/v1/places:autocomplete
```

### 2. Strict Location Restriction (Rectangular Viewport) with FieldMask

Restrict results strictly inside a bounding box, calculate distance from an
`origin`, filter by `includedPrimaryTypes`, and apply a `FieldMask`:

```bash
curl -X POST -d '{
  "input": "Art museum",
  "includedPrimaryTypes": ["museum", "art_gallery"],
  "origin": {
    "latitude": 37.7749,
    "longitude": -122.4194
  },
  "locationRestriction": {
    "rectangle": {
      "low": {
        "latitude": 37.7751,
        "longitude": -122.4219
      },
      "high": {
        "latitude": 37.7955,
        "longitude": -122.3937
      }
    }
  },
  "sessionToken": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}' \
-H 'Content-Type: application/json' \
-H 'X-Goog-Api-Key: YOUR_API_KEY' \
-H 'X-Goog-FieldMask: suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.distanceMeters' \
-H 'X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1' \
https://places.googleapis.com/v1/places:autocomplete
```

### 3. JavaScript (`fetch`) Implementation

```javascript
async function getPlaceAutocomplete(inputQuery, sessionToken) {
  const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': 'YOUR_API_KEY',
      'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types',
      'X-Goog-Maps-Solution-ID': 'gmp_git_agentskills_v1'
    },
    body: JSON.stringify({
      input: inputQuery,
      sessionToken: sessionToken,
      includedRegionCodes: ['us'],
      locationBias: {
        circle: {
          center: { latitude: 37.7749, longitude: -122.4194 },
          radius: 5000.0
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Autocomplete request failed: ${response.status}`);
  }

  return await response.json();
}
```

--------------------------------------------------------------------------------

## Response Structure & Nuances

The API returns a JSON object containing a `suggestions` array with up to 5
items ordered by relevance:

```json
{
  "suggestions": [
    {
      "placePrediction": {
        "place": "places/ChIJ5YQQf1GHhYARPKG7WLIaOko",
        "placeId": "ChIJ5YQQf1GHhYARPKG7WLIaOko",
        "text": {
          "text": "Amoeba Music, Haight Street, San Francisco, CA, USA",
          "matches": [{ "endOffset": 6 }]
        },
        "structuredFormat": {
          "mainText": {
            "text": "Amoeba Music",
            "matches": [{ "endOffset": 6 }]
          },
          "secondaryText": {
            "text": "Haight Street, San Francisco, CA, USA"
          }
        },
        "types": ["electronics_store", "point_of_interest", "store", "establishment"],
        "distanceMeters": 3012
      }
    },
    {
      "queryPrediction": {
        "text": {
          "text": "Amoeba Music",
          "matches": [{ "endOffset": 6 }]
        }
      }
    }
  ]
}
```

### Key Implementation Rules & Best Practices

1.  **Follow-up Requests**:
    -   Use `placePrediction.placeId` in a **Place Details (New)** request
        (passing the same `sessionToken` and a field mask) if you need rich
        place details (opening hours, business status, etc.).
    -   Use **Geocoding API** without session tokens if you *only* need the
        address and lat/lng coordinates AND users select a prediction in 4 or
        fewer requests on average.
    -   Use `queryPrediction.text.text` as input to a **Text Search (New)**
        request.
2.  **Missing `distanceMeters` Handling**: Even when `origin` is provided,
    `distanceMeters` is omitted for `route` predictions or when the distance is
    less than 1 meter (`0`). Client libraries parsing this field may default
    missing values to `0`—**do not display a zero distance to users**.
3.  **Fallback on No Selection**: If a user submits raw text without choosing a
    prediction, fall back to the Geocoding API (for address inputs,
    subpremise/apartment addresses, or road-segment prefixes) or Place Details /
    Text Search (for named places).
