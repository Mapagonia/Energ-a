(() => {
  "use strict";
  const config = window.GDS_CONFIG || {title:"GeoDash - GIS Dev",subtitle:"Dashboard geográfico",theme:{primary:"#ef2929"},layers:[],widgets:[]};
  const layerData = window.GDS_LAYERS || {};
  Object.entries(layerData).forEach(([layerId,data]) => (data.features || []).forEach((feature,index) => {
    feature._gdsid = `${layerId}:${index}`;
  }));

  const storedTheme = (() => { try { return localStorage.getItem("gds-theme"); } catch { return null; } })();
  const state = {
    filters:{}, search:"", selected:null, maps:[], charts:[], featureLayers:new Map(),
    visible:new Set(Object.keys(layerData)), tableSort:{}, basemap:"Calles",
    extentEnabled:false, extentBounds:null,
    dark:storedTheme ? storedTheme === "dark" : !!config.theme?.dark,
  };
  document.documentElement.style.setProperty("--primary", config.theme?.primary || "#ef2929");
  document.body.classList.toggle("dark", state.dark);
  document.title = config.title || "GeoDash - GIS Dev";

  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[ch]));
  const norm = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
  const slug = value => layerData[value] ? value : (config.layers?.find(layer=>layer.id===value)?.id || value);
  const metaFor = id => config.layers?.find(layer=>layer.id===id) || layerData[id]?._meta || {};
  const numeric = value => typeof value === "number" ? value : Number(String(value ?? "").replace(",","."));
  const fmt = value => Number.isInteger(value) ? value.toLocaleString("es-AR") : value.toLocaleString("es-AR",{maximumFractionDigits:2});
  const formatCell = value => {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "number") return fmt(value);
    const text = String(value);
    const parsed = /^\d{4}-\d{2}-\d{2}/.test(text) ? new Date(text.replace(" ","T")) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString("es-AR",{dateStyle:"medium",timeStyle:"short"}) : text;
  };
  const featureLabel = feature => {
    const props = feature.properties || {};
    const preferred = ["nombre","name","titulo","title","id","codigo"].find(key => props[key] != null);
    if (preferred) return String(props[preferred]);
    const text = Object.values(props).find(value => typeof value === "string" && value.length > 1);
    return text || `Registro ${feature._gdsid?.split(":")[1] || ""}`;
  };
  const layerBaseColor = id => {
    const style=metaFor(id).style||{};
    return style.color || style.categories?.[0]?.color || style.ranges?.[0]?.color || config.theme?.primary || "#ef2929";
  };
  const colorForFeature = (id,feature) => {
    const style=metaFor(id).style||{}, value=feature.properties?.[style.field];
    if(style.mode==="categorized"){
      const category=(style.categories||[]).find(item=>String(item.value)===String(value));
      return category?.color||style.color||"#94a3b8";
    }
    if(style.mode==="graduated"){
      const number=numeric(value), range=(style.ranges||[]).find(item=>number>=Number(item.lower)&&number<=Number(item.upper));
      return range?.color||style.color||"#94a3b8";
    }
    return style.color||config.theme?.primary||"#ef2929";
  };
  const searchEntries = feature => {
    const entries=Object.entries(feature.properties||{});
    Object.entries(feature._relations||{}).forEach(([layerId,properties])=>{
      Object.entries(properties||{}).forEach(([key,value])=>entries.push([`${metaFor(layerId).name||layerId} · ${key}`,value]));
    });
    return entries;
  };
  const matchesSearch = feature => {
    const query = norm(state.search);
    return !query || searchEntries(feature).some(([key,value]) => norm(key).includes(query) || norm(value).includes(query));
  };
  const featureInExtent = feature => {
    if(!state.extentEnabled||!state.extentBounds||!feature.geometry)return true;
    const points=[];
    const walk=value=>{if(Array.isArray(value)&&value.length>=2&&typeof value[0]==="number"&&typeof value[1]==="number")points.push(value);else if(Array.isArray(value))value.forEach(walk)};
    walk(feature.geometry.coordinates);
    if(!points.length)return true;
    const xs=points.map(point=>point[0]),ys=points.map(point=>point[1]);
    const box={west:Math.min(...xs),east:Math.max(...xs),south:Math.min(...ys),north:Math.max(...ys)}, view=state.extentBounds;
    return box.east>=view.west&&box.west<=view.east&&box.north>=view.south&&box.south<=view.north;
  };
  const valueForFeature = (feature,field,relationLayer) => relationLayer
    ? feature._relations?.[relationLayer]?.[field]
    : feature.properties?.[field];
  const featuresFor = id => (layerData[id]?.features || []).filter(feature => {
    if (!matchesSearch(feature)) return false;
    if (!featureInExtent(feature)) return false;
    return Object.entries(state.filters).every(([key,value]) => {
      if (!value) return true;
      const split = key.indexOf("::");
      const layer = key.slice(0,split), field = key.slice(split+2);
      if(layer===id)return String(feature.properties?.[field]??"")===String(value);
      const related=feature._relations?.[layer];
      return related ? String(related[field]??"")===String(value) : true;
    });
  });
  const categoryValuesForWidget = widget => {
    const source=slug(widget.layer), relation=widget.relationLayer?slug(widget.relationLayer):"";
    const values=(layerData[source]?.features||[]).map(feature=>valueForFeature(feature,widget.field,relation)).filter(value=>value!==null&&value!==undefined&&value!=="");
    if(!values.length&&relation)return [...new Set((layerData[relation]?.features||[]).map(feature=>feature.properties?.[widget.field]).filter(value=>value!==null&&value!==undefined&&value!==""))].sort();
    return [...new Set(values)].sort();
  };
  const aggregate = (features, field, operation) => {
    if (operation === "count" || !field) return features.length;
    const values = features.map(f => numeric(f.properties?.[field])).filter(Number.isFinite);
    if (!values.length) return 0;
    if (operation === "sum") return values.reduce((a,b)=>a+b,0);
    if (operation === "avg") return values.reduce((a,b)=>a+b,0)/values.length;
    if (operation === "min") return Math.min(...values);
    if (operation === "max") return Math.max(...values);
    return values.length;
  };
  const texto = `
  La información presentada en este DASHBOARD proviene de la Secretaría de Energía de la Nación, a través de la Subsecretaría de Eficiencia e Información Energética y la Dirección Nacional de Escenarios y Evaluación de Proyectos.
 <br> <br> La capa llamada   <strong>Centrales de Generación de Energía Eléctrica   </strong>nos brinda información sobre las diferentes características, potencias, ubicación, y empresas a cargo de estas infraestructuras. 
  <br> <br> Se propone esta herramienta de consulta e interacción para explorar la distribución territorial de las centrales eléctricas, identificar sus características y conocer las diferentes tecnologías que forman parte de la matriz de generación energética nacional.

  `;
  function shell(){
    const layerRows = (config.layers||[]).map(layer => `<label class="layer-row" title="${esc(layer.sourceName||layer.name)}"><input type="checkbox" data-layer-toggle="${esc(layer.id)}"${state.visible.has(layer.id)?" checked":""}><span class="layer-dot" style="background:${esc(layerBaseColor(layer.id))}"></span><span class="layer-name">${esc(layer.name)}</span><small>${(layerData[layer.id]?.features||[]).length}</small></label>`).join("") || "";
    const filters = (config.widgets||[]).filter(w=>w.type==="filter").map(w=>{
      const id=w.relationLayer?slug(w.relationLayer):slug(w.layer), values=categoryValuesForWidget(w);
      return `<div class="filter-control"><label>${esc(w.title)}</label><select data-filter="${esc(id)}::${esc(w.field)}"><option value="">Todos los valores</option>${values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("")}</select></div>`;
    }).join("");
    document.querySelector("#app").innerHTML = `<div class="shell">
      <aside class="sidebar"><div class="brand"><img class="brand-logo" src="assets/logo-gis-dev.png" alt="GIS Dev"><span>GeoDash <small>GIS Dev</small></span></div>
        <div class="nav-title">SOBRE EL DASHBOARD</div>
        <div class="filter-control">${texto}</div>
        <div class="sidebar-bottom"><div class="logo-mapagonia"><img src="assets/logo-mapagonia.png"></div></div>
      </aside>
      <main class="main"><header class="topbar"><button class="mobile-menu" aria-label="Abrir menú">☰</button>
      <div class="title-block"><h1>${esc(config.title)}</h1><p>${esc(config.subtitle)}</p></div>
      <div class="top-actions"><div class="search-wrap"><input class="search" type="search" placeholder="Buscar por cualquier campo…" aria-label="Buscar"><button class="search-clear" aria-label="Limpiar búsqueda">×</button><div class="search-results"></div></div>
      <button class="theme-toggle" title="Cambiar tema" aria-label="Cambiar tema">${state.dark?"☀":"◐"}</button><span class="status">● Datos listos</span></div>
      </header><div class="active-bar"><div class="active-items"></div><button class="reset-all">↺ Volver a vista general</button></div>
      <div class="content"><section class="dashboard-grid" id="grid"></section></div></main>
      </div>`;
  }

  //<div class="nav-title">CAPAS PUBLICADAS</div>${layerRows || '<div class="filter-control">Sin capas cargadas</div>'}
  //${filters ? `<div class="nav-title">FILTROS DEL DASHBOARD</div>${filters}`:""}
  //<div class="sidebar-bottom"><label class="upload">＋ Cargar GeoJSON<input id="geoUpload" type="file" accept=".json,.geojson,application/geo+json"></label></div>
  
  function autoLayouts(widgets){
    let x=0,y=Math.max(0,...widgets.filter(widget=>widget.layout).map(widget=>(Number(widget.layout.y)||0)+(Number(widget.layout.h)||3))),rowHeight=0;
    return widgets.map(widget=>{
      if(widget.layout)return widget.layout;
      const w=Math.max(2,Math.min(12,Number(widget.span)||6));
      const h={map:5,table:4,bar:4,pie:4,kpi:2,filter:2,text:2}[widget.type]||3;
      if(x+w>12){y+=rowHeight;x=0;rowHeight=0}
      const layout={x,y,w,h}; x+=w; rowHeight=Math.max(rowHeight,h); return layout;
    });
  }
  function card(widget,index,layout){
    const column=Math.max(1,(Number(layout.x)||0)+1), row=Math.max(1,(Number(layout.y)||0)+1);
    const span=Math.max(2,Math.min(12,Number(layout.w)||Number(widget.span)||6));
    const rows=Math.max(1,Number(layout.h)||3);
    return `<article class="card ${widget.type==="kpi"?"kpi-card":""} ${widget.type==="text"?"text-card":""}" style="--column:${column};--row:${row};--span:${span};--rows:${rows}" data-widget="${index}">
      <div class="card-head"><div><h2>${esc(widget.title||widget.type)}</h2><span class="card-subtitle">${esc(metaFor(slug(widget.layer)).name||"")}</span></div><span class="card-kicker">${widget.type.toUpperCase()}</span></div>
      <div class="card-body" id="widget-${index}"></div></article>`;
  }
  function render(){
    state.maps.forEach(map=>map.remove()); state.maps=[]; state.featureLayers.clear();
    state.charts.forEach(chart=>chart.destroy()); state.charts=[];
    const widgets=config.widgets||[], layouts=autoLayouts(widgets);
    document.querySelector("#grid").innerHTML=widgets.map((widget,index)=>card(widget,index,layouts[index])).join("")||'<div class="card empty" style="--column:1;--row:1;--span:12;--rows:3">Agregá widgets desde el plugin de QGIS.</div>';
    widgets.forEach((widget,index)=>renderWidget(widget,index,true));
    syncControls(); renderActiveBar();
  }
  function renderWidget(widget,index,includeMap){
    const target=document.querySelector(`#widget-${index}`); if(!target)return;
    const layer=slug(widget.layer), features=featuresFor(layer);
    if(widget.type==="kpi")renderKpi(target,widget,features);
    else if(widget.type==="map"&&includeMap)renderMap(target,widget);
    else if(widget.type==="bar"||widget.type==="pie")renderChart(target,widget,features);
    else if(widget.type==="table")renderTable(target,widget,features,layer);
    else if(widget.type==="filter")renderFilterCard(target,widget);
    else if(widget.type==="text")target.innerHTML=`<p>${esc(widget.text||config.subtitle||"Contenido descriptivo del dashboard.")}</p>`;
  }
  function renderDataWidgets(){
    state.charts.forEach(chart=>chart.destroy());state.charts=[];
    (config.widgets||[]).forEach((widget,index)=>{if(widget.type!=="map")renderWidget(widget,index,false)});
    syncControls();renderActiveBar();
  }
  function renderKpi(target,widget,features){
    const value=aggregate(features,widget.value||widget.field,widget.operation||"count");
    target.innerHTML=`<div class="kpi-value">${fmt(value)}</div><div class="kpi-caption">${widget.operation==="count"?"registros visibles":esc(widget.operation+" · "+(widget.value||widget.field))}</div><div class="kpi-trend">Actualizado con los filtros activos</div>`;
  }
  function renderFilterCard(target,widget){
    const filterLayer=widget.relationLayer?slug(widget.relationLayer):slug(widget.layer), key=`${filterLayer}::${widget.field}`, values=categoryValuesForWidget(widget);
    target.innerHTML=`<div class="filter-card-control"><label>Filtrar todo el dashboard por</label><select data-filter="${esc(key)}"><option value="">Todos los valores</option>${values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join("")}</select><small>${values.length} categorías disponibles</small></div>`;
    target.querySelector("select").value=state.filters[key]||"";
    target.querySelector("select").addEventListener("change",event=>{state.filters[key]=event.target.value;state.selected=null;render()});
  }
  function basemaps(){
    return {
      "Calles":L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:20,attribution:"© OpenStreetMap"}),
      "Satelital":L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{maxZoom:20,attribution:"Tiles © Esri"}),
      "Topográfico":L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",{maxZoom:17,attribution:"© OpenTopoMap"}),
      "Dark":L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",{maxZoom:20,attribution:"© CARTO · © OpenStreetMap"}),
    };
  }
  function featureStyle(feature,layerId){
    const selected=state.selected===feature._gdsid, geom=feature.geometry?.type||"";
    const primary=colorForFeature(layerId,feature),style=metaFor(layerId).style||{};
    if(selected)return {color:"#fff",weight:3,fillColor:"#ffd43b",fillOpacity:1,radius:12};
    const stroke=style.strokeColor|| (geom.includes("Line")?primary:"#fff"), weight=Number(style.strokeWidth??(geom.includes("Line")?3:1.5));
    if(geom.includes("Line"))return {color:stroke,weight,opacity:Number(style.fillOpacity??.85)};
    return {color:stroke,weight,fillColor:primary,fillOpacity:Number(style.fillOpacity??.78),radius:7};
  }
  function popupHtml(feature,layerName){
    const entries=Object.entries(feature.properties||{}), title=featureLabel(feature);
    const rows=entries.slice(0,20).map(([key,value])=>`<div class="popup-row"><span>${esc(key)}</span><strong>${esc(formatCell(value))}</strong></div>`).join("");
    const coords=feature.geometry?.type==="Point"?feature.geometry.coordinates:null;
    return `<div class="feature-popup"><div class="popup-hero"><small>${esc(layerName)}</small><h3>${esc(title)}</h3></div><div class="popup-content">${rows||'<div class="popup-empty">Sin atributos</div>'}</div>${coords?`<div class="popup-coords">⌖ ${coords[1].toFixed(5)}, ${coords[0].toFixed(5)}</div>`:""}</div>`;
  }
  function renderMap(target,widget){
    target.parentElement.classList.add("map-card"); target.className="card-body map"; target.innerHTML="";
    if(typeof L==="undefined"){target.innerHTML='<div class="empty">No se encontró el motor de mapas.</div>';return}
    const map=L.map(target,{zoomControl:true,attributionControl:true});
    const bases=basemaps(); (bases[state.basemap]||bases.Calles).addTo(map);
    L.control.layers(bases,{}, {position:"topright",collapsed:true}).addTo(map);
    map.on("baselayerchange",event=>{state.basemap=event.name});
    const ExtentControl=L.Control.extend({options:{position:"topleft"},onAdd(){
      const button=L.DomUtil.create("button","extent-filter-control");button.type="button";button.title="Actualizar indicadores, gráficos y tablas con las entidades visibles";
      button.innerHTML="⌗ <span>Filtrar por vista</span>";button.classList.toggle("active",state.extentEnabled);L.DomEvent.disableClickPropagation(button);
      L.DomEvent.on(button,"click",()=>{state.extentEnabled=!state.extentEnabled;button.classList.toggle("active",state.extentEnabled);if(state.extentEnabled){const bounds=map.getBounds();state.extentBounds={west:bounds.getWest(),east:bounds.getEast(),south:bounds.getSouth(),north:bounds.getNorth()}}else state.extentBounds=null;renderDataWidgets()});return button;
    }});new ExtentControl().addTo(map);
    let extentTimer;map.on("moveend",()=>{if(!state.extentEnabled)return;clearTimeout(extentTimer);extentTimer=setTimeout(()=>{const bounds=map.getBounds();state.extentBounds={west:bounds.getWest(),east:bounds.getEast(),south:bounds.getSouth(),north:bounds.getNorth()};state.selected=null;renderDataWidgets()},120)});
    const bounds=[];
    Object.entries(layerData).forEach(([id,data])=>{
      if(!state.visible.has(id))return;
      const filtered={type:"FeatureCollection",features:featuresFor(id)};
      const geo=L.geoJSON(filtered,{style:feature=>featureStyle(feature,id),pointToLayer:(feature,ll)=>L.circleMarker(ll,featureStyle(feature,id)),onEachFeature:(feature,leafletLayer)=>{
        leafletLayer.bindPopup(popupHtml(feature,data._meta?.name||id),{maxWidth:360,minWidth:260,className:"geodash-popup"});
        leafletLayer.on("click",()=>{state.selected=feature._gdsid;setTimeout(render,0)});
        state.featureLayers.set(feature._gdsid,{layer:leafletLayer,map});
      }}).addTo(map);
      if(geo.getBounds().isValid())bounds.push(geo.getBounds());
    });
    //addLegend(map);
    if(bounds.length){const all=L.latLngBounds([]);bounds.forEach(bound=>all.extend(bound));map.fitBounds(all.pad(.08),{maxZoom:16})}
    else map.setView([-34.6,-58.45],9);
    const selected=state.selected?state.featureLayers.get(state.selected):null;
    if(selected)setTimeout(()=>focusLeafletFeature(selected),80);
    state.maps.push(map); setTimeout(()=>map.invalidateSize(),80);
  }
  function addLegend(map){
    const styled=config.layers?.filter(layer=>state.visible.has(layer.id)&&layer.style)||[];
    if(!styled.length)return;
    const control=L.control({position:"bottomright"});
    control.onAdd=()=>{const div=L.DomUtil.create("div","map-legend");div.innerHTML=`<b>Leyenda</b>${styled.map(layer=>{const style=layer.style||{};let classes=[];if(style.mode==="categorized")classes=(style.categories||[]).slice(0,8);else if(style.mode==="graduated")classes=(style.ranges||[]).slice(0,8);else classes=[{label:layer.name,color:style.color}];return `<div class="legend-layer"><span>${esc(layer.name)}</span>${classes.map(item=>`<small><i style="background:${esc(item.color||layerBaseColor(layer.id))}"></i>${esc(item.label??item.value??layer.name)}</small>`).join("")}</div>`}).join("")}`;L.DomEvent.disableClickPropagation(div);return div};control.addTo(map);
  }
  function focusLeafletFeature(entry){
    const layer=entry.layer,map=entry.map;
    if(layer.getLatLng)map.setView(layer.getLatLng(),Math.max(map.getZoom(),16),{animate:true});
    else if(layer.getBounds&&layer.getBounds().isValid())map.fitBounds(layer.getBounds().pad(.45),{maxZoom:17,animate:true});
    if(layer.setStyle)layer.setStyle({color:"#fff",weight:3,fillColor:"#ffd43b",fillOpacity:1,radius:12});
    if(layer.setRadius)layer.setRadius(12);
    if(layer.bringToFront)layer.bringToFront(); layer.openPopup();
  }
  function grouped(features,field,valueField,operation,relationLayer){
    const groups=new Map();
    features.forEach(feature=>{const key=String(valueForFeature(feature,field,relationLayer)??"Sin dato");if(!groups.has(key))groups.set(key,[]);groups.get(key).push(feature)});
    return [...groups.entries()].map(([label,items])=>({label,value:aggregate(items,valueField,operation)})).sort((a,b)=>b.value-a.value).slice(0,18);
  }
  function renderChart(target,widget,features){
    if(!widget.field){target.innerHTML='<div class="empty">Elegí un campo de categoría para construir este gráfico.</div>';return}
    target.innerHTML='<div class="chart-wrap"><canvas></canvas></div>'; if(typeof Chart==="undefined")return;
    const relation=widget.relationLayer?slug(widget.relationLayer):"";
    const groups=grouped(features,widget.field,widget.value,widget.operation||"count",relation), primary=getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
    const key=`${relation||slug(widget.layer)}::${widget.field}`, active=state.filters[key];
    const colors=groups.map((group,index)=>active&&String(active)===group.label?"#ffd43b":(widget.type==="pie"?`hsl(${355+index*37} 75% ${54+(index%3)*7}%)`:primary));
    const chart=new Chart(target.querySelector("canvas"),{type:widget.type==="pie"?"doughnut":"bar",data:{labels:groups.map(g=>g.label),datasets:[{data:groups.map(g=>g.value),backgroundColor:colors,borderRadius:widget.type==="bar"?7:0,borderWidth:active?2:0,borderColor:"#fff"}]},options:{responsive:true,maintainAspectRatio:false,indexAxis:widget.type==="bar"?"y":"x",plugins:{legend:{display:widget.type==="pie",position:"bottom",labels:{usePointStyle:true,boxWidth:8,color:state.dark?"#dce2ec":"#566176"}},tooltip:{callbacks:{footer:()=>"Clic para filtrar el mapa"}}},scales:widget.type==="bar"?{x:{beginAtZero:true,grid:{color:state.dark?"rgba(255,255,255,.08)":"rgba(120,130,150,.12)"},ticks:{color:state.dark?"#aeb7c6":"#677187"}},y:{grid:{display:false},ticks:{color:state.dark?"#dce2ec":"#566176"}}}:{},onClick:(_,els)=>{if(!els.length)return;const value=groups[els[0].index].label;state.filters[key]=String(state.filters[key])===value?"":value;state.selected=null;render()}}});
    state.charts.push(chart);
  }
  function sortedFeatures(features,layer){
    const sort=state.tableSort[layer]; if(!sort?.field)return features;
    return [...features].sort((a,b)=>{const av=a.properties?.[sort.field],bv=b.properties?.[sort.field];return String(av??"").localeCompare(String(bv??""),"es",{numeric:true})*(sort.dir==="asc"?1:-1)});
  }
  function renderTable(target,widget,features,layer){
    target.className="card-body table-wrap"; const rows=sortedFeatures(features,layer);
    const fields=[...new Set(rows.slice(0,40).flatMap(f=>Object.keys(f.properties||{})))].slice(0,12);
    if(!rows.length||!fields.length){target.innerHTML='<div class="empty">No hay registros para los filtros actuales.</div>';return}
    const sort=state.tableSort[layer]||{};
    target.innerHTML=`<div class="table-scroll"><table><thead><tr><th class="locate-col">Mapa</th>${fields.map(field=>`<th><button class="sort-button" data-sort-field="${esc(field)}">${esc(field)} ${sort.field===field?(sort.dir==="asc"?"↑":"↓"):"↕"}</button></th>`).join("")}</tr></thead><tbody>${rows.slice(0,500).map(feature=>`<tr data-feature="${esc(feature._gdsid)}" class="${state.selected===feature._gdsid?"selected-row":""}"><td class="locate-col"><button class="locate-button" title="Mostrar en el mapa">⌖</button></td>${fields.map(field=>`<td class="${Number.isFinite(numeric(feature.properties?.[field]))?"numeric":""}">${esc(formatCell(feature.properties?.[field]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div><div class="table-footer"><span><b>${rows.length.toLocaleString("es-AR")}</b> registros visibles</span><span>Clic en una fila para localizarla en el mapa</span></div>`;
    target.querySelectorAll("tbody tr").forEach(row=>row.addEventListener("click",()=>{state.selected=row.dataset.feature;render();setTimeout(()=>document.querySelector(".map-card")?.scrollIntoView({behavior:"smooth",block:"center"}),60)}));
    target.querySelectorAll("[data-sort-field]").forEach(button=>button.addEventListener("click",event=>{event.stopPropagation();const field=button.dataset.sortField;state.tableSort[layer]={field,dir:sort.field===field&&sort.dir==="asc"?"desc":"asc"};render()}));
  }
  function highlightTableRow(){document.querySelectorAll("[data-feature]").forEach(row=>row.classList.toggle("selected-row",row.dataset.feature===state.selected))}
  function renderActiveBar(){
    const container=document.querySelector(".active-items"), bar=document.querySelector(".active-bar"); if(!container||!bar)return;
    const chips=[];
    if(state.search)chips.push(`<button data-clear-search>Buscar: <b>${esc(state.search)}</b> ×</button>`);
    Object.entries(state.filters).forEach(([key,value])=>{if(value){const field=key.split("::")[1];chips.push(`<button data-clear-filter="${esc(key)}">${esc(field)}: <b>${esc(value)}</b> ×</button>`)}});
    if(state.selected)chips.push(`<button data-clear-selection>Entidad seleccionada ×</button>`);
    if(state.extentEnabled)chips.push(`<button data-clear-extent>Vista del mapa ×</button>`);
    container.innerHTML=chips.join(""); bar.classList.toggle("show",chips.length>0);
    container.querySelectorAll("[data-clear-filter]").forEach(button=>button.addEventListener("click",()=>{state.filters[button.dataset.clearFilter]="";render()}));
    container.querySelector("[data-clear-search]")?.addEventListener("click",()=>{state.search="";render()});
    container.querySelector("[data-clear-selection]")?.addEventListener("click",()=>{state.selected=null;render()});
    container.querySelector("[data-clear-extent]")?.addEventListener("click",()=>{state.extentEnabled=false;state.extentBounds=null;render()});
  }
  function syncControls(){
    const search=document.querySelector(".search"); if(search&&search.value!==state.search)search.value=state.search;
    document.querySelectorAll("[data-filter]").forEach(select=>{select.value=state.filters[select.dataset.filter]||""});
  }
  function searchMatches(query){
    const q=norm(query); if(q.length<2)return [];
    const hits=[];
    Object.entries(layerData).some(([layerId,data])=>{for(const feature of data.features||[]){const matched=searchEntries(feature).find(([key,value])=>norm(key).includes(q)||norm(value).includes(q));if(matched)hits.push({layerId,feature,field:matched[0],value:matched[1]});if(hits.length>=8)return true}return false});
    return hits;
  }
  function renderSearchResults(){
    const box=document.querySelector(".search-results"); if(!box)return;
    const hits=searchMatches(state.search);
    box.innerHTML=hits.map(hit=>`<button data-search-feature="${esc(hit.feature._gdsid)}"><span class="result-icon">⌖</span><span><b>${esc(featureLabel(hit.feature))}</b><small>${esc(metaFor(hit.layerId).name||hit.layerId)} · ${esc(hit.field)}: ${esc(formatCell(hit.value))}</small></span></button>`).join("");
    box.classList.toggle("open",hits.length>0);
    box.querySelectorAll("[data-search-feature]").forEach(button=>button.addEventListener("click",()=>{state.selected=button.dataset.searchFeature;box.classList.remove("open");render()}));
  }
  function resetAll(){state.filters={};state.search="";state.selected=null;state.extentEnabled=false;state.extentBounds=null;render()}
  function bind(){
    document.querySelector(".mobile-menu").addEventListener("click",()=>document.querySelector(".sidebar").classList.toggle("open"));
    let searchTimer; document.querySelector(".search").addEventListener("input",event=>{state.search=event.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{render();renderSearchResults()},120)});
    document.querySelector(".search").addEventListener("focus",renderSearchResults);
    document.querySelector(".search-clear").addEventListener("click",()=>{state.search="";render()});
    document.querySelector(".reset-all").addEventListener("click",resetAll);
    document.querySelector(".theme-toggle").addEventListener("click",()=>{state.dark=!state.dark;document.body.classList.toggle("dark",state.dark);try{localStorage.setItem("gds-theme",state.dark?"dark":"light")}catch{}document.querySelector(".theme-toggle").textContent=state.dark?"☀":"◐";render()});
    document.querySelectorAll("[data-filter]").forEach(select=>select.addEventListener("change",event=>{state.filters[event.target.dataset.filter]=event.target.value;state.selected=null;render()}));
    document.querySelectorAll("[data-layer-toggle]").forEach(box=>box.addEventListener("change",event=>{event.target.checked?state.visible.add(event.target.dataset.layerToggle):state.visible.delete(event.target.dataset.layerToggle);render()}));
    //document.querySelector("#geoUpload").addEventListener("change",event=>{const file=event.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const data=JSON.parse(reader.result),id=`upload-${Date.now()}`;(data.features||[]).forEach((feature,index)=>feature._gdsid=`${id}:${index}`);data._meta={id,name:file.name.replace(/\.[^.]+$/,"") ,fields:Object.keys(data.features?.[0]?.properties||{})};layerData[id]=data;if(!Array.isArray(config.layers))config.layers=[];config.layers.push(data._meta);state.visible.add(id);shell();bind();render();toast("Capa añadida al dashboard")}catch{toast("El archivo no es un GeoJSON válido")}};reader.readAsText(file)});
  }
  function toast(message){const node=document.createElement("div");node.className="toast";node.textContent=message;document.body.appendChild(node);setTimeout(()=>node.remove(),2800)}
  shell();bind();render();
})();
