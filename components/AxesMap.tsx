"use client";

// Carte de la page « Axes » (Leaflet). Chargée uniquement côté navigateur (import dynamique, ssr: false).
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, useMap, useMapEvents, ZoomControl } from "react-leaflet";
import type { MapPoint } from "@/lib/axes-map";
import { axeColor } from "./axes-colors";

export interface MapAxe {
  index: number;
  geometry: [number, number][];
  stops: number[]; // ordre de passage (index des points)
}

interface Props {
  tileUrl: string;
  tileAttribution: string;
  site: { lat: number; lon: number };
  siteName: string;
  points: MapPoint[];
  axeOf: number[]; // axe de chaque point dans le découpage affiché (-1 = hors axe)
  axes: MapAxe[];
  focus: number | null; // axe mis en avant : les autres sont estompés, ses arrêts sont numérotés
  hidden: Set<number>; // axes masqués
  roads: boolean; // tracés sur les routes (sinon lignes droites, en pointillé)
  selected: number | null;
  placing: boolean; // le prochain clic sur la carte place le point sélectionné
  onSiteMove: (p: { lat: number; lon: number }) => void;
  onPointClick: (i: number) => void;
  onMapClick: (p: { lat: number; lon: number }) => void;
  fitKey: string; // change => recadrage sur les points
}

const siteIcon = L.divIcon({
  className: "site-pin",
  html: '<span class="site-pin-dot"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/></svg></span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const stopIcon = (n: number, color: string) =>
  L.divIcon({ className: "stop-pin", html: `<span style="background:${color}">${n}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });

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
    if (ll.length > 1) map.fitBounds(L.latLngBounds(ll), { padding: [40, 40], maxZoom: 14 });
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
  const dim = (axe: number) => (p.focus !== null && axe !== p.focus) || p.hidden.has(axe);
  const focused = p.focus !== null ? p.axes.find((a) => a.index === p.focus) : undefined;

  return (
    <MapContainer center={[p.site.lat, p.site.lon]} zoom={12} className="axes-map" scrollWheelZoom zoomControl={false}>
      <TileLayer url={p.tileUrl} attribution={p.tileAttribution} maxZoom={19} />
      <ZoomControl position="bottomright" />
      <ClickHandler onClick={p.onMapClick} placing={p.placing} />
      <Fit points={p.points} site={p.site} fitKey={p.fitKey} />
      {p.axes.map((a) =>
        a.geometry.length > 1 && !p.hidden.has(a.index) ? (
          <Polyline
            key={`${a.index}-${a.geometry.length}-${a.geometry[0]?.join()}-${p.focus}`}
            positions={a.geometry}
            pathOptions={{
              color: axeColor(a.index),
              weight: p.focus === a.index ? 6 : 4,
              opacity: dim(a.index) ? 0.15 : 0.85,
              dashArray: p.roads ? undefined : "6 7",
              lineCap: "round",
              lineJoin: "round",
            }}
          />
        ) : null
      )}
      {p.points.map((pt, i) => {
        if (pt.lat === null || pt.lon === null) return null;
        const axe = p.axeOf[i] ?? -1;
        const faded = axe >= 0 ? dim(axe) : p.focus !== null;
        return (
          <CircleMarker
            key={i}
            center={[pt.lat, pt.lon]}
            radius={Math.min(12, 5 + Math.sqrt(Math.max(1, pt.agents)) * 1.5) + (p.selected === i ? 3 : 0)}
            pathOptions={{
              color: p.selected === i ? "#0f172a" : axe < 0 ? "#64748b" : "#ffffff",
              weight: p.selected === i ? 3 : axe < 0 ? 2 : 1.5,
              dashArray: axe < 0 ? "2 3" : undefined,
              fillColor: axeColor(axe),
              fillOpacity: faded ? 0.25 : axe < 0 ? 0.55 : 0.95,
              opacity: faded ? 0.4 : 1,
            }}
            eventHandlers={{ click: (e) => { L.DomEvent.stopPropagation(e); p.onPointClick(i); } }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <b>{pt.key}</b>
              {pt.agents ? ` · ${pt.agents} agent${pt.agents > 1 ? "s" : ""}` : ""}
              {axe >= 0 ? ` · Axe ${axe + 1}` : " · hors axe"}
            </Tooltip>
          </CircleMarker>
        );
      })}
      {/* ordre de passage de l'axe mis en avant */}
      {focused?.stops.map((s, k) => {
        const pt = p.points[s];
        return pt?.lat == null || pt.lon == null ? null : (
          <Marker key={`stop-${s}`} position={[pt.lat, pt.lon]} icon={stopIcon(k + 1, axeColor(focused.index))} eventHandlers={{ click: () => p.onPointClick(s) }} zIndexOffset={500} />
        );
      })}
      <Marker position={[p.site.lat, p.site.lon]} icon={siteIcon} draggable eventHandlers={siteHandlers} zIndexOffset={1000}>
        <Tooltip direction="top" offset={[0, -14]} permanent className="site-tip">{p.siteName}</Tooltip>
      </Marker>
    </MapContainer>
  );
}
