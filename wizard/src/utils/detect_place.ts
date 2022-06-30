/**
 * Copyright 2022 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {
  ConfidenceLevel,
  DCProperty,
  DCType,
  DetectedDetails,
  TypeProperty,
} from "../types";
import countriesJSON from "./country_mappings.json";

const MIN_HIGH_CONF_DETECT = 0.9;

// All supported Place types must be encoded below.
const PLACE_TYPES: DCType[] = [
  { dcName: "GeoCoordinates", displayName: "Geo Coordinates" },
  { dcName: "state", displayName: "State" },
  { dcName: "country", displayName: "Country" },
  { dcName: "province", displayName: "Province" },
  { dcName: "municipality", displayName: "Municipality" },
  { dcName: "county", displayName: "County" },
  { dcName: "city", displayName: "City" },
];

// All supported Place properties must be encoded below.
const PLACE_PROPERTIES: DCProperty[] = [
  { dcName: "name", displayName: "Name" },
  { dcName: "longitude", displayName: "Longitude" },
  { dcName: "latitude", displayName: "Latitude" },
  { dcName: "isoCode", displayName: "ISO Code" },
  { dcName: "countryAlpha3Code", displayName: "Alpha 3 Code" },
  { dcName: "countryNumericCode", displayName: "Numeric Code" },
];

// Helper interface to refer to the place types and place properties.
interface TPName {
  tName: string;
  pName: string;
}

function toAlphaNumeric(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/gi, "");
}

/**
 * A PlaceDetector objected is meant to be initialized once. It provides
 * convenience access to all place types and their supported formats. It also
 * supports detecting the place type for each individual column (a header and
 * a list of string values).
 */
export class PlaceDetector {
  countryNames: Set<string>;
  countryISO: Set<string>;
  countryAbbrv3: Set<string>;
  countryNumeric: Set<string>;

  // Convenience in-memory maps of types and properties where the keys are their
  // respective DC Names.
  placeTypes: Map<string, DCType>;
  placeProperties: Map<string, DCProperty>;

  // A set of all place types and their associated properties.
  placeTypesAndProperties: Set<TypeProperty>;

  // Mapping between Place types and supported properties associated with each
  // type. The keys of columnToTypePropertyMapping are matched against the column
  // headers in the user csv files. If a column header matches a key in
  // columnToTypePropertyMapping then the associated value in
  // columnToTypePropertyMapping is the inferred location type and property.
  static columnToTypePropertyMapping = new Map<string, Array<TPName>>([
    ["longitude", [{ tName: "GeoCoordinates", pName: "longitude" }]],
    ["latitude", [{ tName: "GeoCoordinates", pName: "latitude" }]],
    ["latlon", [{ tName: "GeoCoordinates", pName: "name" }]],
    ["geocoordinates", [{ tName: "GeoCoordinates", pName: "name" }]],
    [
      "country",
      [
        { tName: "country", pName: "name" },
        { tName: "country", pName: "isoCode" },
        { tName: "country", pName: "countryAlpha3Code" },
        { tName: "country", pName: "countryNumericCode" },
      ],
    ],
    ["state", [{ tName: "state", pName: "name" }]],
    ["province", [{ tName: "province", pName: "name" }]],
    ["municipality", [{ tName: "municipality", pName: "name" }]],
    ["county", [{ tName: "county", pName: "name" }]],
    ["city", [{ tName: "city", pName: "name" }]],
  ]);

  constructor() {
    // Set the various class attributes.
    this.preProcessCountries();
    this.setValidPlaceTypesAndProperties();
  }

  /**
   * Processes columnToTypePropertyMapping to set the placeTypesAndProperties attribute.
   */
  setValidPlaceTypesAndProperties() {
    // Process the PLACE_TYPES.
    this.placeTypes = new Map<string, DCType>();
    for (const t of PLACE_TYPES) {
      this.placeTypes.set(t.dcName, t);
    }
    // Process the PLACE_PROPERTIES.
    this.placeProperties = new Map<string, DCProperty>();
    for (const p of PLACE_PROPERTIES) {
      this.placeProperties.set(p.dcName, p);
    }

    // Process the columnToTypePropertyMapping.
    const tpMap = new Map<string, TypeProperty>();
    const valArray = Array.from(
      PlaceDetector.columnToTypePropertyMapping.values()
    );
    for (const tpNames of valArray) {
      for (const tp of tpNames) {
        // Create unique keys using a combination of the type and property.
        const key = tp.tName + tp.pName;
        if (tpMap.has(key)) {
          continue;
        }
        tpMap.set(key, {
          dcType: this.placeTypes.get(tp.tName),
          dcProperty: this.placeProperties.get(tp.pName),
        });
      }
    }
    this.placeTypesAndProperties = new Set(tpMap.values());
  }

  /**
   * Process the countriesJSON object to generate the required sets.
   */
  preProcessCountries() {
    this.countryNames = new Set<string>();
    this.countryISO = new Set<string>();
    this.countryAbbrv3 = new Set<string>();
    this.countryNumeric = new Set<string>();

    for (const country of countriesJSON) {
      this.countryNames.add(toAlphaNumeric(country.name));

      if (country.iso_code != null) {
        this.countryISO.add(toAlphaNumeric(country.iso_code));
      }
      if (country.country_alpha_3_code != null) {
        this.countryAbbrv3.add(toAlphaNumeric(country.country_alpha_3_code));
      }
      if (country.country_numeric_code != null) {
        this.countryNumeric.add(toAlphaNumeric(country.country_numeric_code));
      }
    }
  }

  /**
   * The low confidence column detector simply checks if the column header
   * (string) matches one of the keys in columnToTypePropertyMapping.
   * The header is converted to lower case and only alphanumeric chars are used.
   * If there is no match, the return value is null.
   *
   * @param header the name of the column.
   *
   * @return the TypeProperty object (with no PlaceProperty) or null if nothing
   *  can be determined with low confidence.
   */
  detectLowConfidence(header: string): TypeProperty {
    const h = header.toLowerCase().replace(/[^a-z0-9]/gi, "");
    if (PlaceDetector.columnToTypePropertyMapping.has(h)) {
      // Use any of the TPNames in the Array<TPName> associated with the
      // value associated with 'h'. All the TPNames associated with 'h' are
      // expected to have the same place type (tName).
      const typeName =
        PlaceDetector.columnToTypePropertyMapping.get(h)[0].tName;

      // Use null for the PlaceProperty because we are only matching types
      // for the low confidence cases.
      return { dcType: this.placeTypes.get(typeName) };
    }
    return null;
  }

  /**
   * Country is detected with high confidence if > 90% of the non-null column
   * values match one of the country format (property) arrays.
   * If country is not detected, null is returned.
   * If country is detected, the TypeProperty is returned.
   *
   * @param column: an array of strings representing the column values.
   *
   * @return the TypeProperty object or null if nothing can be determined with
   *  high confidence.
   */
  detectCountryHighConf(column: Array<string>): TypeProperty {
    let numValid = 0;
    let nameCounter = 0;
    let isoCounter = 0;
    let alphaNum3Counter = 0;
    let numberCounter = 0;

    for (const cVal of column) {
      if (cVal == null) {
        continue;
      }
      const v = toAlphaNumeric(cVal);
      numValid++;

      if (this.countryNames.has(v)) {
        nameCounter++;
      } else if (this.countryISO.has(v)) {
        isoCounter++;
      } else if (this.countryAbbrv3.has(v)) {
        alphaNum3Counter++;
      } else if (this.countryNumeric.has(v)) {
        numberCounter++;
      }
    }

    // Determine the detected property.
    let p: DCProperty;
    if (nameCounter > numValid * MIN_HIGH_CONF_DETECT) {
      p = this.placeProperties.get("name");
    } else if (isoCounter > numValid * MIN_HIGH_CONF_DETECT) {
      p = this.placeProperties.get("isoCode");
    } else if (alphaNum3Counter > numValid * MIN_HIGH_CONF_DETECT) {
      p = this.placeProperties.get("countryAlpha3Code");
    } else if (numberCounter > numValid * MIN_HIGH_CONF_DETECT) {
      p = this.placeProperties.get("countryNumericCode");
    } else {
      p = null;
    }
    if (p != null) {
      return { dcType: this.placeTypes.get("country"), dcProperty: p };
    } else {
      return null;
    }
  }

  /**
   * Detects with high confidence the type and property for a Place.
   * If a place cannot be detected, returns null.
   * Currently only supports detecting country (place type).
   *
   * @param header the name of the column.
   * @param column: an array of strings representing the column values.
   *
   * @return the TypeProperty object or null if nothing can be determined with
   * high confidence.
   */
  detectHighConfidence(header: string, column: Array<string>): TypeProperty {
    // For now, only supports detecting country with high confidence.
    // In the future, this should be modified to run through a list of detailed
    // high confidence place detectors.
    return this.detectCountryHighConf(column);
  }

  /**
   * Detecting Place.
   * If nothing is detected, null is returned.
   * Otherwise, the detectedTypeProperty is returned.
   * It is up to the consumer, e.g. in heuristics.ts, to decide whether to
   * pass the low confidence detection back to the user (or not).
   *
   * @param header: the column header string.
   * @param column: an array of string column values.
   *
   * @return the DetectedDetails object (or null).
   */
  detect(header: string, column: Array<string>): DetectedDetails {
    const lcDetected = this.detectLowConfidence(header);
    const hcDetected = this.detectHighConfidence(header, column);

    if (hcDetected != null) {
      // High Confidence detection is given higher priority.
      return {
        detectedTypeProperty: hcDetected,
        confidence: ConfidenceLevel.High,
      };
    } else if (lcDetected != null) {
      return {
        detectedTypeProperty: lcDetected,
        confidence: ConfidenceLevel.Low,
      };
    } else {
      return null;
    }
  }
}
