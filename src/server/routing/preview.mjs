import { parseWrite } from '../../contracts/requests.mjs';
import { loadRoutingEngine, buildCatalogSnapshot, prepareClassification, routePrepared } from './adapter.mjs';

export async function routingPreview(db, actor, body, classifier) {
  if (actor.role !== 'CITIZEN') {
    const error = new Error('Нет доступа'); error.code = 'FORBIDDEN'; throw error;
  }
  const input = parseWrite('preview', body);
  const territory = await db.query(
    'SELECT code FROM territories WHERE id=$1 AND region_id=$2 AND active',
    [input.territoryId, actor.regionId]);
  if (!territory.rows.length) {
    const error = new Error('Выберите активную территорию'); error.code = 'VALIDATION_ERROR';
    error.fields = { territoryId: 'Территория недоступна' }; throw error;
  }
  const engine = await loadRoutingEngine();
  const prepared = await prepareClassification(input,classifier,{actorId:actor.id});
  const snapshot = await buildCatalogSnapshot(db, actor.regionId);
  let decision;
  try { decision = routePrepared(engine,{ ...input, territoryCode: territory.rows[0].code },snapshot,prepared); }
  catch (error) {
    if (error.name !== 'RoutingInputError' && error.code !== 'ROUTING_INPUT') throw error;
    const failure = new Error('Проверьте заполнение формы'); failure.code = 'VALIDATION_ERROR';
    failure.fields = { [error.field === 'territoryCode' ? 'territoryId' : error.field || 'territoryId']: error.message };
    throw failure;
  }
  const { scores, evidence, analysis, ...projection } = decision;
  void scores; void evidence; void analysis;
  return projection;
}
