"use client";

// Carte de la page « Axes » (Leaflet). Chargée uniquement côté navigateur (import dynamique, ssr: false).
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import type { MapPoint } from "@/lib/axes-map";

import { axeColor } from "./axes-colors";

export interface MapAxe {
  index: number;
  geometry: [number, number][];
  highlighted: boolean;
}

interface Props {
  tileUrl: string;
  tileAttribution: string;
  site: { lat: number; lon: number };
  siteName: string;
  points: MapPoint[];
  axeOf: number[]; // axe de chaque point dans le découpage affiché (-1 = hors axe)
  axes: MapAxe[];
  selected: number | null;
  placing: boolean; // le prochain clic sur la carte place le point sélectionné
  onSiteMove: (p: { lat: number; lon: number }) => void;
  onPointClick: (i: number) => void;
  onMapClick: (p: { lat: number; lon: number }) => void;
  fitKey: string; // change => recadrage sur les points
}

const siteIcon = L.divIcon({
  className: "site-pin",
  html: '<span class="site-pin-dot"></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

function ClickHandler({ onClick, placing }: { onClick: (p: { lat: number; lon: number }) => void; placing: boolean }) {
  const map = useMapEvents({ click: (e) => onClick({ lat: e.latlng.lat, lon: e.latlng.lng }) });
  useEffect(() => {
    map.getContainer().style.cursor = placing ? "crosshair" : "";
  }, [map, placing]);
  return null;
}

function Fit({ points, site, fitKey }: { points: MapPoint[]; site: { lat: number; lon: number }; fitKey: string }) {
  const map = useMap();
  useEffect(() => {
    const ll = points.filter((p) => p.lat !== null).map((p) => L.latLng(p.lat!, p.lon!));
    ll.push(L.latLng(site.lat, site.lon));
    if (ll.length > 1) map.fitBounds(L.latLngBounds(ll), { padding: [30, 30], maxZoom: 14 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

export default function AxesMap(p: Props) {
  const siteHandlers = useMemo(
    () => ({
      dragend: (e: L.LeafletEvent) => {
        const ll = (e.target as L.Marker).getLatLng();
        p.onSiteMove({ lat: ll.lat, lon: ll.lng });
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.onSiteMove]
  );
  return (
    <MapContainer center={[p.site.lat, p.site.lon]} zoom={12} className="axes-map" scrollWheelZoom>
      <TileLayer url={p.tileUrl} attribution={p.tileAttribution} maxZoom={19} />
      <ClickHandler onClick={p.onMapClick} placing={p.placing} />
      <Fit points={p.points} site={p.site} fitKey={p.fitKey} />
      {p.axes.map((a) =>
        a.geometry.length > 1 ? (
          <Polyline key={`${a.index}-${a.geometry.length}-${a.geometry[0]?.join()}`} positions={a.geometry} pathOptions={{ color: axeColor(a.index), weight: a.highlighted ? 6 : 3.5, opacity: a.highlighted ? 0.95 : 0.6 }} />
        ) : null
      )}
      {p.points.map((pt, i) =>
        pt.lat === null || pt.lon === null ? null : (
          <CircleMarker
            key={i}
            center={[pt.lat, pt.lon]}
            radius={Math.min(13, 5 + Math.sqrt(Math.max(1, pt.agents)) * 1.6) + (p.selected === i ? 3 : 0)}
            pathOptions={{ color: p.selected === i ? "#0f172a" : "#ffffff", weight: p.selected === i ? 3 : 1.5, fillColor: axeColor(p.axeOf[i] ?? -1), fillOpacity: 0.95 }}
            eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); p.onPointClick(i); } }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <b>{pt.key}</b>
              {pt.agents ? ` · ${pt.agents} agent${pt.agents > 1 ? "s" : ""}` : ""}
              {(p.axeOf[i] ?? -1) >= 0 ? ` · Axe ${p.axeOf[i] + 1}` : " · hors axe"}
            </Tooltip>
          </CircleMarker>
        )
      )}
      <Marker position={[p.site.lat, p.site.lon]} icon={siteIcon} draggable eventHandlers={siteHandlers}>
        <Tooltip direction="top" offset={[0, -12]} permanent>{p.siteName}</Tooltip>
      </Marker>
    </MapContainer>
  );
}
