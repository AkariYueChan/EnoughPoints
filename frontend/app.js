'use strict';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => Number(n).toLocaleString('zh-CN', {maximumFractionDigits:2});
const fields = {code:'课程编号', name:'课程名称 *', type:'必修 / 选修 *', category:'课程类别', credits:'学分 *', terms:'开设学期'};
let plan = null, imported = null, draft = null, editingId = null, editingVersion = null;
let filters = {search:'', english:false, company:false}, saving = false, dirty = false, saveError = false, toastTimer;
let dragState=null, suppressClickUntil=0;

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers:{'X-EnoughPoints':'1', ...(options.body instanceof ArrayBuffer ? {} : {'Content-Type':'application/json'}), ...options.headers}});
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || '操作失败'); error.issues = data.issues; error.status = response.status; throw error; }
  return data;
}
const post = (url, data) => api(url, {method:'POST', body:JSON.stringify(data)});
function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3500); }
function showError(message) { const el = $('importError'); if(el) {el.textContent=message;el.hidden=false;el.scrollIntoView({block:'nearest'});} else toast(message); }
function termName(term) { if(!term) return '待安排'; return `大${['','一','二','三','四','五','六','七','八','九','十'][Math.ceil(term/2)]}${term%2?'上':'下'} · 第 ${term} 学期`; }
function steps(n) { $('steps').innerHTML = ['01 上传文件','02 对应字段','03 核对与设置'].map((t,i)=>`<span class="${i===n?'active':''}">${t}</span>`).join(''); }
function errorBox() { return '<div id="importError" class="error-message" role="alert" hidden></div>'; }
function openDialog(id) { if(!$(id).open) $(id).showModal(); }

async function refreshPlans(selectId) {
  const plans = await api('/api/plans');
  $('planSelect').innerHTML='<option value="">我的方案</option>'+plans.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${p.courseCount} 门</option>`).join('');
  /* 这里是「选择历史方案并打开规划页」的入口，默认停在占位项，避免选中项无法再次触发切换 */
  $('planSelect').value=selectId || '';
  return plans;
}
/* ★ 前后端对接：方案由后端保存，导入窗口不再自己渲染规划页。
   选定历史方案或确认导入后，统一跳转到规划页，课程与目标由后端注入。 */
async function loadPlan(id) {
  if(!await flushSave()) return;
  location.href='/planner?id='+encodeURIComponent(id);
}
function startImport() {
  if(dirty || saving) {toast('请等待方案保存成功后再导入');return;}
  void discardImport().catch(e=>toast(e.message));draft=null;editingId=null;editingVersion=null;
  $('importTitle').textContent='导入课程表'; steps(0);
  $('importContent').innerHTML=`<div class="upload-zone" id="uploadZone"><span class="upload-icon">↥</span><h2>把课程表放在这里</h2><p>支持 .xlsx / .xls · 最大 10 MB · 由本机后端解析</p><input id="fileInput" type="file" accept=".xlsx,.xls" aria-label="选择 Excel 文件"><p>也可以将 Excel 文件拖到此区域</p></div>${errorBox()}<div class="dialog-footer"><a class="download-link" href="/sample.xlsx" download="原始课程表.xlsx">下载原始课程表示例 ↗</a><button id="importSample">使用示例体验</button></div>`;
  $('fileInput').onchange=e=>{if(e.target.files[0]) upload(e.target.files[0]);};
  $('importSample').onclick=useSample;
  const zone=$('uploadZone');
  zone.ondragover=e=>{e.preventDefault();zone.classList.add('drop-over');};
  zone.ondragleave=()=>zone.classList.remove('drop-over');
  zone.ondrop=e=>{e.preventDefault();zone.classList.remove('drop-over');if(e.dataTransfer.files[0]) upload(e.dataTransfer.files[0]);};
  openDialog('importDialog');
}
async function discardImport() {
  const token=imported?.importId; imported=null;
  if(token) await api('/api/imports/'+encodeURIComponent(token), {method:'DELETE'});
}
let uploading=false;
async function upload(file) {
  if(uploading) return;
  if(!/\.(xlsx|xls)$/i.test(file.name)) return showError('请选择 .xlsx 或 .xls 文件');
  if(file.size>10*1024*1024) return showError('文件超过 10 MB，请拆分后导入');
  uploading=true;const button=$('importSample');if(button) button.disabled=true;
  try {toast('正在读取工作簿…');imported=await api('/api/import?filename='+encodeURIComponent(file.name),{method:'POST',body:await file.arrayBuffer()});if(!$('importDialog').open){await discardImport();return;}renderMapping();}
  catch(e){showError(e.message);}
  finally{uploading=false;if(button) button.disabled=false;}
}
async function useSample() {
  if(! $('importDialog').open) startImport();
  try {const response=await fetch('/sample.xlsx');if(!response.ok) throw new Error('示例文件不可用');await upload(new File([await response.blob()],'原始课程表.xlsx'));} catch(e){showError(e.message);}
}
function columnName(index) {let s='';for(let n=index+1;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
function mappingOptions(sheet, selected, header) {
  const row=sheet.preview[header-1]||[];
  const width=Math.max(...sheet.preview.map(r=>r.length),0);
  return '<option value="">不导入此字段</option>'+Array.from({length:width},(_,i)=>`<option value="${i}" ${i===selected?'selected':''}>${columnName(i)} · ${esc(row[i]||'（空白表头）')}</option>`).join('');
}
function renderMapping(index=imported.activeIndex||0) {
  imported.activeIndex=index;
  steps(1);const sheet=imported.sheets[index];
  $('importContent').innerHTML=`<p class="muted">${esc(imported.filename)} · 找到 ${imported.sheets.length} 个工作表。请检查“必修 / 选修”是否对应实际内容。</p><div class="form-grid"><label>工作表<select id="sheetSelect">${imported.sheets.map((s,i)=>`<option value="${i}" ${i===index?'selected':''}>${esc(s.name)}（${s.rowCount} 行）</option>`).join('')}</select></label><label>表头所在行<input id="headerRow" type="number" min="1" max="${sheet.rowCount}" value="${sheet.header}"></label></div><div class="mapping-grid">${Object.entries(fields).map(([key,label])=>`<label>${label}<select id="map-${key}">${mappingOptions(sheet,sheet.mapping[key],sheet.header)}</select></label>`).join('')}</div><div class="notice">优先根据表头和单元格内容自动匹配。下方为前 60 行预览；蓝色行为选定表头。复杂表格可以手动调整字段所在列。</div><div class="table-scroll" id="rawPreview"></div>${errorBox()}<div class="dialog-footer"><button id="backUpload">重新选择文件</button><button id="parseButton" class="primary">识别并核对课程 →</button></div>`;
  const preview=()=>{
    const header=Number($('headerRow').value);
    $('rawPreview').innerHTML=`<table><thead><tr><th>行</th>${(sheet.preview[0]||[]).map((_,i)=>`<th>${columnName(i)}</th>`).join('')}</tr></thead><tbody>${sheet.preview.map((r,i)=>`<tr class="${i+1===header?'header-highlight':''}"><td>${i+1}</td>${r.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  };
  preview();$('sheetSelect').onchange=e=>renderMapping(Number(e.target.value));
  $('headerRow').onchange=()=>{for(const key of Object.keys(fields)){const select=$('map-'+key), current=select.value;select.innerHTML=mappingOptions(sheet,current===''?null:Number(current),Number($('headerRow').value));}preview();};
  $('backUpload').onclick=startImport;
  $('parseButton').onclick=async()=>{
    $('parseButton').disabled=true;
    try {
      const mapping=Object.fromEntries(Object.keys(fields).map(k=>[k,$('map-'+k).value===''?null:Number($('map-'+k).value)]));
      sheet.mapping=mapping;sheet.header=Number($('headerRow').value);
      const result=await post('/api/parse',{importId:imported.importId,sheet:sheet.name,header:sheet.header,mapping});
      const maxTerm=Math.max(6,...result.courses.flatMap(c=>Array.isArray(c.terms)?c.terms:[]));
      draft={name:imported.filename.replace(/\.(xlsx|xls)$/i,''),source:imported.filename,termCount:maxTerm,courses:result.courses,selected:[],goals:{total:null,elective:null,categories:{}}};
      imported=null;
      renderReview(result.issues,`已识别 ${result.courses.length} 门课程，跳过 ${result.skipped} 行空白、表头或合计。`);
    }catch(e){showError(e.message);if($('parseButton'))$('parseButton').disabled=false;}
  };
}
function issuesHTML(issues) {
  if(!issues.length)return '<p class="muted">字段校验通过，请核对原表与学分目标。</p>';
  const errors=issues.filter(i=>i.level==='error').length;
  return `<div class="issues"><b>${errors} 个错误 · ${issues.length-errors} 条提醒</b>${issues.map(i=>`<p class="${i.level}">${i.level==='error'?'错误':'提醒'} · 第 ${i.index+1} 门${draft.courses[i.index]?.name?'「'+esc(draft.courses[i.index].name)+'」':''}：${esc(i.message)}</p>`).join('')}</div>`;
}
function renderReview(issues=[],note='课程可直接修改，确认后生成规划。') {
  steps(2);$('importTitle').textContent=editingId?'修改课程与目标':'核对课程与目标';
  const cats=['公共基础课','专业课'];
  const errorIds=new Set(issues.filter(i=>i.level==='error').map(i=>i.id));
  $('importContent').innerHTML=`<section class="goals"><h3>学分要求 <span class="count">选填 · 空白表示未知</span></h3><div class="form-grid">${cats.map(c=>`<label>${esc(c)} · 最低学分<input data-goal-category="${esc(c)}" type="number" min="0" max="10000" step="0.01" value="${esc(draft.goals.categories[c]??'')}" placeholder="待填写"></label>`).join('')}<label>最低总学分（自动合计）<input id="goalTotal" type="number" min="0" max="10000" step="0.01" readonly aria-describedby="goalTotalHelp" placeholder="填写两类学分后自动合计"></label><label>最低选修学分<input id="goalElective" type="number" min="0" max="10000" step="0.01" value="${draft.goals.elective??''}" placeholder="例如 15"></label></div><p class="muted" id="goalTotalHelp">总学分＝公共基础课学分＋专业课学分。两类都填写后自动合计；没有要求的类别可填 0。</p></section><div class="notice">${esc(note)} 学分目标请参考正式培养方案填写，留空时不判断达标。${draft.source==='原始课程表.xlsx'?'<br>示例表的“公共基础课应修 58”与原 HTML 的 49 不一致，需核实；本工具不会自动采用任一值。':''}</div><div class="form-grid"><label>方案名称<input id="draftName" maxlength="120" value="${esc(draft.name)}"></label><label>总学期数<input id="draftTerms" type="number" min="1" max="20" value="${draft.termCount}"></label></div><div class="button-row"><h3>课程明细 <span class="count">${draft.courses.length} 门</span></h3><button id="addCourse">＋ 添加课程</button><button id="validateButton">重新校验</button></div><div id="issueList">${issuesHTML(issues)}</div><div class="table-scroll editor-table"><table><thead><tr><th># / 来源行</th><th>课程编号</th><th>课程名称</th><th>性质</th><th>类别</th><th>学分</th><th>学期</th><th></th></tr></thead><tbody>${draft.courses.map((c,i)=>`<tr data-row="${i}" class="${errorIds.has(c.id)?'error-row':''}"><td class="source-cell" title="${esc(c.source?.sheet||'手动添加')}">${i+1}${c.source?.row?' / 行 '+c.source.row:''}</td><td><input aria-label="第 ${i+1} 门课程编号" data-field="code" value="${esc(c.code)}"></td><td><input aria-label="第 ${i+1} 门课程名称" class="name-input" data-field="name" value="${esc(c.name)}"></td><td><select aria-label="第 ${i+1} 门课程性质" data-field="type"><option value="">请选择</option>${['必修','选修'].map(t=>`<option ${c.type===t?'selected':''}>${t}</option>`).join('')}</select></td><td><select aria-label="第 ${i+1} 门课程类别" data-field="category"><option value="" ${!['公共基础课','专业课'].includes(c.category)?'selected':''}>${!['公共基础课','专业课'].includes(c.category)?'请选择（原值：'+esc(c.category||'空白')+'）':'请选择'}</option>${['公共基础课','专业课'].map(t=>`<option ${c.category===t?'selected':''}>${t}</option>`).join('')}</select></td><td><input aria-label="第 ${i+1} 门学分" class="short-input" data-field="credits" inputmode="decimal" value="${esc(c.credits)}"></td><td><input aria-label="第 ${i+1} 门学期" data-field="terms" value="${esc(Array.isArray(c.terms)?c.terms.join(','):c.terms)}" placeholder="1,2"></td><td><button class="text-btn danger" data-remove="${i}" aria-label="删除第 ${i+1} 门课程">✕</button></td></tr>`).join('')}</tbody></table></div><p class="muted">学期支持 1,2、1-3、大一上；留空时列入“待安排”。跨学期课程总学分只计一次，重复行会分别计分。</p>${errorBox()}<div class="dialog-footer"><button id="reviewBack">${editingId?'取消修改':'重新上传文件'}</button><div class="button-row"><span class="muted">继续表示已核对课程及提醒</span><button id="confirmImport" class="primary">${editingId?'保存修改':'确认并开始规划'} →</button></div></div>`;
  document.querySelectorAll('[data-goal-category]').forEach(input=>input.addEventListener('input',updateGoalTotal));
  updateGoalTotal();
  $('addCourse').onclick=()=>{collectDraft();draft.courses.push({id:crypto.randomUUID(),code:'',name:'',type:'选修',category:'',credits:'',terms:[],source:{},notes:[]});renderReview();};
  $('importContent').querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>{collectDraft();draft.courses.splice(Number(b.dataset.remove),1);renderReview();});
  $('validateButton').onclick=async()=>{collectDraft();try{const result=await post('/api/validate',draft);draft=result.plan;renderReview(result.issues);}catch(e){showError(e.message);}};
  $('reviewBack').onclick=()=>editingId?$('importDialog').close():startImport();
  $('confirmImport').onclick=saveDraft;
}
function updateGoalTotal() {
  const inputs=[...document.querySelectorAll('[data-goal-category]')];
  const complete=inputs.length===2&&inputs.every(input=>input.value!==''&&input.validity.valid);
  $('goalTotal').value=complete?String(inputs.reduce((sum,input)=>sum+Math.round(Number(input.value)*100),0)/100):'';
}
function collectDraft() {
  updateGoalTotal();
  draft.name=$('draftName').value.trim();draft.termCount=Number($('draftTerms').value);
  document.querySelectorAll('[data-row]').forEach(row=>{const c=draft.courses[Number(row.dataset.row)];row.querySelectorAll('[data-field]').forEach(input=>c[input.dataset.field]=input.value.trim());});
  draft.goals={total:$('goalTotal').value,elective:$('goalElective').value,categories:{}};
  const cats=new Set(draft.courses.map(c=>c.category||'未分类'));
  document.querySelectorAll('[data-goal-category]').forEach(input=>{if(cats.has(input.dataset.goalCategory))draft.goals.categories[input.dataset.goalCategory]=input.value;});
}
async function saveDraft() {
  collectDraft();$('confirmImport').disabled=true;
  try {
    const checked=await post('/api/validate',draft);
    if(checked.issues.some(i=>i.level==='error')) {draft=checked.plan;renderReview(checked.issues);showError('请修正上面的错误，再开始规划');return;}
    draft=checked.plan;
    const result=await api(editingId?'/api/plans/'+editingId:'/api/plans',{method:editingId?'PUT':'POST',body:JSON.stringify({...draft,version:editingVersion})});
    plan=result;dirty=false;saveError=false;filters={search:'',english:false,company:false};
    $('importDialog').close();await refreshPlans();
    /* 正式点击导入：数据已存入后端，交接到规划页，之后的交互全部由该页面处理 */
    location.href='/planner?id='+encodeURIComponent(plan.id);
  }catch(e){if(e.issues){renderReview(e.issues);}showError(e.message);if($('confirmImport'))$('confirmImport').disabled=false;}
}
function localStats() {
  const chosen=plan.courses.filter(c=>plan.selected.includes(c.id));
  const sum=arr=>Math.round(arr.reduce((s,c)=>s+Math.round(c.credits*100),0))/100;
  const categories=Object.fromEntries([...new Set(plan.courses.map(c=>c.category))].map(cat=>[cat,sum(chosen.filter(c=>c.category===cat))]));
  const total=sum(chosen),elective=sum(chosen.filter(c=>c.type==='选修'));
  const checks=[['总学分',total,plan.goals.total],['选修学分',elective,plan.goals.elective],...Object.entries(plan.goals.categories).map(([c,t])=>[c,categories[c]||0,t])].filter(x=>x[2]!==null&&x[2]!==undefined).map(([label,actual,target])=>({label,actual,target,met:actual>=target,gap:Math.max(0,Math.round((target-actual)*100)/100)}));
  return {total,elective,required:sum(chosen.filter(c=>c.type==='必修')),selectedCount:chosen.length,categories,checks,status:!checks.length?'unknown':checks.every(c=>c.met)?'met':'incomplete'};
}
function progress(actual,target) {return target===null||target===undefined?'':`<div class="bar ${actual>=target?'ok':''}"><i style="width:${target===0?100:Math.min(100,actual/target*100)}%"></i></div>`;}
function publicCourse(c) {return /公共|通识/.test(c.category);}
function card(c,selected,term=null) {
  const required=c.type==='必修';const style=required?(publicCourse(c)?'public':'required'):'elective';
  return `<article class="course-card ${required?'required':''} ${style==='public'?'public':''}" data-course="${esc(c.id)}" data-selected="${selected}" ${required?'':`draggable="true" tabindex="0" role="button" aria-label="${selected?'移除':'选入'} ${esc(c.name)}"`}><div class="card-meta"><span class="tag ${style}">${required?'必修':'选修'}</span><span>${esc(term?termName(term):c.terms.length?'第 '+c.terms.join(' / ')+' 学期':'待安排')}</span></div><div class="course-name">${esc(c.name)}</div><div class="card-bottom"><span class="credit">${fmt(c.credits)}<small>学分${c.terms.length>1?' · 跨学期':''}</small></span><span class="card-action" title="${required?'必修已固定':selected?'点击退回待选':'点击加入计划'}">${required?'固定':selected?'−':'＋'}</span></div></article>`;
}
function renderPlanner() {
  $('empty').hidden=!!plan;$('planner').hidden=!plan;if(!plan)return;
  const s=localStats();
  const status=s.status==='unknown'?'目标待填写':s.status==='met'?'已达配置目标':'规划进行中';
  const remaining=s.checks.filter(c=>!c.met).map(c=>`${c.label}还差 ${fmt(c.gap)} 分`).join(' · ');
  $('planner').innerHTML=`<div class="page-head"><div><span class="eyebrow">MY CURRICULUM PLANNER</span><h1>${esc(plan.name)}</h1><p class="page-sub">${plan.courses.length} 门课程 · ${plan.termCount} 个学期 · 来源：${esc(plan.source||'手动整理')}</p></div><div class="button-row"><span id="saveStatus" class="save-state">已保存到本机</span><button id="editPlan">编辑课程与目标</button><button id="exportPlan" title="导出结构化 JSON 数据备份">导出数据 ↗</button><button id="deletePlan" class="text-btn danger">删除</button></div></div><div class="summary-grid"><div class="summary-card"><div class="summary-label">我的计划学分<span class="status-pill ${s.status==='met'?'ok':''}">${status}</span></div><div class="summary-value">${fmt(s.total)}<small>${plan.goals.total===null?'学分 · 总目标待填写':'/ '+fmt(plan.goals.total)+' 学分'}</small></div>${progress(s.total,plan.goals.total)}<div class="summary-caption">${s.selectedCount} 门已排入 · 跨学期课程学分仅计一次</div></div><div class="summary-card"><div class="summary-label">必修学分<span>固定排入</span></div><div class="summary-value req">${fmt(s.required)}<small>学分</small></div><div class="summary-caption">${plan.courses.filter(c=>c.type==='必修').length} 门必修课已加入计划</div></div><div class="summary-card"><div class="summary-label">选修学分<span>${plan.goals.elective===null?'目标待填写':'目标 ≥ '+fmt(plan.goals.elective)}</span></div><div class="summary-value elec">${fmt(s.elective)}<small>学分</small></div><div class="summary-caption">${plan.courses.filter(c=>c.type==='选修'&&plan.selected.includes(c.id)).length} 门已选 · 按兴趣自由组合</div></div></div><div class="rules-line"><div><b>规划提示</b>　${esc(remaining||(s.status==='unknown'?'填写学分目标后，可查看与目标的差额。':'已达到当前配置的学分目标；不代表已取得学分或满足全部毕业条件。'))}</div><div class="legend"><span>公共必修</span><span class="req">其他必修</span><span class="elec">选修</span></div></div><div class="board"><aside class="pool" data-drop="pool"><div class="panel-head"><div class="panel-title"><h3>待选课程</h3><span id="poolCount" class="count"></span></div><div class="panel-desc">点击 ＋ 或拖入右侧，加入计划</div></div><div class="filters"><input id="courseSearch" class="search-input" placeholder="搜索课程名称或编号…" aria-label="搜索待选课程" value="${esc(filters.search)}"><div class="filter-row"><button id="filterEnglish" class="filter-chip ${filters.english?'active':''}">排除全英文</button><button id="filterCompany" class="filter-chip ${filters.company?'active':''}">排除企业课</button><button id="resetFilters" class="filter-chip">清除筛选</button></div></div><div id="poolCourses" class="course-list"></div></aside><div id="selectedCourses" data-drop="selected">${Object.entries(s.categories).map(([cat,credits])=>{
    const target=plan.goals.categories[cat];const chosen=plan.courses.filter(c=>c.category===cat&&plan.selected.includes(c.id));
    const terms=[...new Set(chosen.flatMap(c=>c.terms.length?c.terms:[0]))].sort((a,b)=>(a||99)-(b||99));
    return `<section class="category-panel"><div class="panel-head"><div class="panel-title"><div><h3>${esc(cat)}</h3><div class="panel-desc">${chosen.length} 门课程 · 按学期排列</div></div><div class="category-progress"><b>${fmt(credits)}</b> ${target===undefined?'学分 / 目标待填写':'/ '+fmt(target)+' 学分'}${progress(credits,target)}</div></div></div><div class="course-list">${terms.length?terms.map(t=>`<div class="term-heading"><b>${termName(t)}</b></div>${chosen.filter(c=>t?c.terms.includes(t):!c.terms.length).map(c=>card(c,true,t)).join('')}`).join(''):'<div class="empty-courses">将课程拖到这里，开始安排</div>'}</div></section>`;
  }).join('')}</div></div><div class="bottom-actions"><div><h3>把你的选择，整理成一张学期表。</h3><p>${s.status==='met'?'已达到配置目标，可生成选课表。':'尚未达标或目标未填写，也可以先生成规划草案。'}</p></div><div class="button-row"><button id="resetSelection">重置选修</button><button id="scheduleButton" class="primary">生成学期选课表 →</button></div></div>`;
  renderPool();updateSaveStatus();bindCards();
  $('courseSearch').oninput=e=>{filters.search=e.target.value;renderPool();bindCards();};
  $('filterEnglish').onclick=()=>{filters.english=!filters.english;renderPlanner();};
  $('filterCompany').onclick=()=>{filters.company=!filters.company;renderPlanner();};
  $('resetFilters').onclick=()=>{filters={search:'',english:false,company:false};renderPlanner();};
  $('resetSelection').onclick=()=>{if(!confirm('将所有选修课退回待选区？必修课会继续保留。'))return;plan.selected=plan.courses.filter(c=>c.type==='必修').map(c=>c.id);markDirty();};
  $('editPlan').onclick=async()=>{if(!await flushSave())return;editingId=plan.id;editingVersion=plan.version;draft=structuredClone(plan);renderReview();openDialog('importDialog');};
  $('exportPlan').onclick=async()=>{if(!await flushSave())return;const blob=new Blob([JSON.stringify(plan,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=plan.name.replace(/[\\/:*?"<>|]/g,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  $('deletePlan').onclick=async()=>{if(!await flushSave()||!confirm('删除当前方案？此操作会移除本机保存的这份方案。'))return;try{await api('/api/plans/'+plan.id,{method:'DELETE'});plan=null;localStorage.removeItem('enoughpoints.last');renderPlanner();await refreshPlans();toast('方案已删除');}catch(e){toast(e.message);}};
  $('scheduleButton').onclick=async()=>{if(await flushSave())showSchedule();};
  document.querySelectorAll('[data-drop]').forEach(zone=>{
    zone.ondragover=e=>{e.preventDefault();zone.classList.add('drop-over');};
    zone.ondragleave=e=>{if(!zone.contains(e.relatedTarget))zone.classList.remove('drop-over');};
    zone.ondrop=e=>{e.preventDefault();zone.classList.remove('drop-over');const id=e.dataTransfer.getData('text/plain');toggleCourse(id,zone.dataset.drop==='selected');};
  });
}
function renderPool() {
  const all=plan.courses.filter(c=>c.type==='选修'&&!plan.selected.includes(c.id));
  const items=all.filter(c=>(!filters.english||!c.name.includes('全英文'))&&(!filters.company||!c.name.includes('企业'))&&(!filters.search||(c.name+' '+c.code).toLowerCase().includes(filters.search.toLowerCase())));
  $('poolCount').textContent=`${items.length} / ${all.length} 门`;
  $('poolCourses').innerHTML=items.length?items.map(c=>card(c,false)).join(''):`<div class="empty-courses">${all.length?'没有符合筛选条件的课程':'所有选修课已加入计划'}</div>`;
}
function bindCards() {
  document.querySelectorAll('[data-course]').forEach(el=>{
    el.onclick=()=>{if(Date.now()<suppressClickUntil)return;toggleCourse(el.dataset.course,!plan.selected.includes(el.dataset.course));};
    el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}};
    el.ondragstart=e=>e.preventDefault();
    el.onpointerdown=e=>{if(e.button!==0||e.pointerType==='touch')return;const c=plan.courses.find(c=>c.id===el.dataset.course);if(c.type==='必修')return;dragState={id:c.id,x:e.clientX,y:e.clientY,moved:false};e.preventDefault();};
  });
}
function toggleCourse(id,selected) {
  const c=plan.courses.find(c=>c.id===id);if(!c)return;
  if(c.type==='必修'){toast('必修课已固定排入计划');return;}
  const ids=new Set(plan.selected);if(selected)ids.add(id);else ids.delete(id);plan.selected=[...ids];markDirty();
}
function markDirty(){dirty=true;saveError=false;renderPlanner();void saveLoop();}
function updateSaveStatus(){const el=$('saveStatus');if(!el)return;el.textContent=saveError?'保存失败 · 点击重试':saving||dirty?'正在保存…':'已保存到本机';el.classList.toggle('error',saveError);el.onclick=saveError?()=>{saveError=false;void saveLoop();}:null;}
async function saveLoop(){
  if(saving)return;saving=true;updateSaveStatus();
  try{while(dirty){dirty=false;const snapshot=structuredClone(plan);try{const result=await api('/api/plans/'+snapshot.id,{method:'PUT',body:JSON.stringify(snapshot)});plan.version=result.version;plan.updated=result.updated;plan.stats=result.stats;}catch(e){dirty=true;saveError=true;toast(e.message);break;}}}
  finally{saving=false;updateSaveStatus();}
}
async function flushSave(){
  if(saving){toast('正在保存，请稍后再试');return false;}
  if(dirty)await saveLoop();return !dirty&&!saveError;
}
function showSchedule(){
  const chosen=plan.courses.filter(c=>plan.selected.includes(c.id)).sort((a,b)=>(a.type==='选修')-(b.type==='选修') || (a.category==='专业课')-(b.category==='专业课')),s=localStats();
  const terms=Array.from({length:plan.termCount},(_,i)=>i+1);if(chosen.some(c=>!c.terms.length))terms.push(0);
  $('scheduleContent').innerHTML=`<div class="schedule-heading"><div><h2>${esc(plan.name)}</h2><p>${s.selectedCount} 门课程 · 计划 ${fmt(s.total)} 学分 · ${s.status==='met'?'达到配置的学分目标':'规划草案（目标未填写或尚未达到）'}</p></div><span class="muted">EnoughPoints</span></div><div class="schedule-grid">${terms.map(t=>`<section class="semester"><h3>${termName(t)}</h3>${chosen.filter(c=>t?c.terms.includes(t):!c.terms.length).map(c=>`<div class="schedule-course"><span><span class="tag ${c.type==='选修'?'elective':publicCourse(c)?'public':'required'}">${c.type}</span> ${esc(c.name)}</span><small>${fmt(c.credits)} 学分${c.terms.length>1?'（跨学期）':''}</small></div>`).join('')||'<p class="muted">本学期尚未安排课程</p>'}</section>`).join('')}</div><p class="muted" style="margin-top:16px">跨学期课程在对应学期重复展示，总学分仅计一次。此表为选课规划，不能作为已获学分或毕业资格证明。</p>`;
  openDialog('scheduleDialog');
}
$('importButton').onclick=$('emptyImport').onclick=startImport;
$('sampleButton').onclick=useSample;
$('helpButton').onclick=()=>openDialog('helpDialog');
$('planSelect').onchange=async e=>{if(e.target.value)try{await loadPlan(e.target.value);}catch(error){toast(error.message);}};
$('printButton').onclick=()=>window.print();
$('toTop').onclick=()=>window.scrollTo({top:0,behavior:'smooth'});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
window.addEventListener('beforeunload',e=>{if(dirty||saving){e.preventDefault();e.returnValue='';}});
document.addEventListener('pointermove',e=>{
  if(!dragState)return;
  if(Math.hypot(e.clientX-dragState.x,e.clientY-dragState.y)>7)dragState.moved=true;
  if(!dragState.moved)return;
  document.body.style.cursor='grabbing';
  document.querySelectorAll('.drop-over').forEach(el=>el.classList.remove('drop-over'));
  document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-drop]')?.classList.add('drop-over');
});
document.addEventListener('pointerup',e=>{
  if(!dragState)return;const current=dragState;dragState=null;document.body.style.cursor='';
  document.querySelectorAll('.drop-over').forEach(el=>el.classList.remove('drop-over'));
  if(!current.moved)return;suppressClickUntil=Date.now()+300;
  const zone=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-drop]');
  if(zone){toggleCourse(current.id,zone.dataset.drop==='selected');toast(zone.dataset.drop==='selected'?'已按课程原有类别加入计划':'已退回待选课程');}
});
document.addEventListener('pointercancel',()=>{dragState=null;document.body.style.cursor='';document.querySelectorAll('.drop-over').forEach(el=>el.classList.remove('drop-over'));});
/* 本页是「数据导入窗口」：启动时只列出历史方案供选择，不自动进入规划页 */
(async()=>{try{await refreshPlans();}catch(e){toast('无法连接本地服务：'+e.message);}})();

$('importDialog').addEventListener('close',()=>{void discardImport().catch(e=>toast(e.message));draft=null;$('importContent').replaceChildren();});
window.addEventListener('pagehide',()=>{if(imported?.importId)fetch('/api/imports/'+encodeURIComponent(imported.importId),{method:'DELETE',headers:{'X-EnoughPoints':'1'},keepalive:true}).catch(()=>{});imported=null;draft=null;plan=null;$('importContent').replaceChildren();});
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
localStorage.removeItem('enoughpoints.last');
