export interface ReviewRow {
  readonly id:string;
  readonly rule:'R1'|'R2'|'R3'|'R4';
  readonly decision:null|'agree'|'disagree'|'uncertain';
}

/** Human decisions only: missing or uncertain votes are never counted as agreement. */
export function summarizeReview(rows:readonly ReviewRow[]) {
  const ids=new Set<string>();
  for(const row of rows) {
    if(ids.has(row.id)||!['R1','R2','R3','R4'].includes(row.rule)||![null,'agree','disagree','uncertain'].includes(row.decision)) throw new TypeError('Invalid or duplicate review row');
    ids.add(row.id);
  }
  return (['R1','R2','R3','R4']as const).map(rule=>{
    const selected=rows.filter(row=>row.rule===rule);
    const agree=selected.filter(row=>row.decision==='agree').length;
    const disagree=selected.filter(row=>row.decision==='disagree').length;
    const uncertain=selected.filter(row=>row.decision==='uncertain').length;
    const pending=selected.filter(row=>row.decision===null).length;
    const ratio=agree+disagree?agree/(agree+disagree):null;
    return {rule,total:selected.length,agree,disagree,uncertain,pending,agreementRatio:ratio,
      needsRetest:ratio!==null&&ratio<0.5,complete:selected.length>0&&pending===0&&uncertain===0,
      status:selected.length===0?'no-findings':pending||uncertain?'pending':'reviewed'};
  });
}
