import cron from 'node-cron';
import { performBackup } from './backup.js';

export function setupCronJobs() {
  // Planifier une sauvegarde chaque jour à minuit (00:00)
  // Syntaxe : minutes heures jour(mois) mois jour(semaine)
  cron.schedule('0 0 * * *', async () => {
    console.log('[CRON] Démarrage de la sauvegarde automatique quotidienne...');
    try {
      const filename = await performBackup();
      console.log(`[CRON] Sauvegarde automatique réussie : ${filename}`);
    } catch (error) {
      console.error('[CRON] Échec de la sauvegarde automatique :', error);
    }
  });

  console.log('[CRON] Tâches planifiées initialisées (Sauvegarde quotidienne à minuit)');
}
