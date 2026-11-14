---
name: elevation-api-web-api
description: Use this skill when retrieving elevation data for specific geographic locations or calculating elevation profiles along paths using the Google Maps Platform Elevation API.
license: Apache-2.0
metadata:
  version: 1.0.54
---

> [!IMPORTANT] **Core Dependency:** This skill requires active context from
> [google-maps-platform/SKILL.md](https://www.gstatic.com/googlemapsplatform-agent-skills/google-maps-platform/SKILL.md).

### Overview

The Elevation API is an HTTP REST service in the Google Maps Platform that
provides elevation data for all locations on the surface of the earth, including
depth locations on the ocean floor (which return negative values).

Use this skill to query the API via HTTP requests to retrieve elevation
measurements (in meters relative to the local mean sea level) for discrete
latitude/longitude coordinates, or to sample elevation changes at equidistant
intervals along a path defined by two or more coordinates.

## Primary Orchestration Integration Workflow

Follow this multi-phase sequential integration checklist to compose features
robustly. For each phase, read the referenced capability sub-workflow file and
satisfy its *Evidence Checkpoint* before advancing.

### Phase 1: Feature Layer & Custom Enrichment (Supplemental)

#### Feature Module: Maps (Optional - Use-Case Dependent)

-   [ ] **Returns the elevation data for one or more discrete latitude/longitude
    locations via an HTTP GET request to the Elevation API.** Read
    [references/return-elevation-set-latitudelongitude-coordinates.md](https://www.gstatic.com/googlemapsplatform-agent-skills/elevation-api-web-api/references/return-elevation-set-latitudelongitude-coordinates.md).
    *Trigger Condition*: Use when the user wants to query the elevation of
    specific, individual latitude/longitude coordinates or encoded polylines
    representing discrete points. *Evidence Checkpoint*: HTTP 200 OK response
    with JSON status 'OK' and a 'results' array containing 'elevation',
    'location', and 'resolution' fields for each requested coordinate.
-   [ ] **Calculates and returns elevation data sampled at equidistant intervals
    along a path defined by two or more latitude/longitude coordinates.** Read
    [references/return-difference-elevation-along-path-between-two-or-more-sets-latitudelongitude-coordinates.md](https://www.gstatic.com/googlemapsplatform-agent-skills/elevation-api-web-api/references/return-difference-elevation-along-path-between-two-or-more-sets-latitudelongitude-coordinates.md).
    *Trigger Condition*: Use when the user wants to get elevation profiles,
    elevation changes, or sampled elevation points along a continuous path or
    route between two or more coordinates. *Evidence Checkpoint*: HTTP 200 OK
    response with JSON status 'OK' and a 'results' array containing the
    specified number of sampled elevation points along the path.
