import { dbManager } from '../database/database.js';

export type FeatureName = 'tickets' | 'autoresponses' | 'statistics' | 'webhooks';

export class FeatureManager {
  private static instance: FeatureManager;
  private featureCache = new Map<string, string[]>();
  private cacheExpiry = new Map<string, number>();
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  static getInstance(): FeatureManager {
    if (!FeatureManager.instance) {
      FeatureManager.instance = new FeatureManager();
    }
    return FeatureManager.instance;
  }

  /**
   * Check if a feature is enabled for a specific guild
   */
  async isFeatureEnabled(guildId: string, feature: FeatureName): Promise<boolean> {
    try {
      // Check cache first
      const cached = this.getCachedFeatures(guildId);
      if (cached) {
        return cached.includes(feature);
      }

      // Fetch from database and cache
      const settings: any = await dbManager.getGuildSettings(guildId);
      const enabledFeatures = settings.enabledFeatures || [];

      this.setCachedFeatures(guildId, enabledFeatures);

      return enabledFeatures.includes(feature);
    } catch (error) {
      console.error(`Error checking feature ${feature} for guild ${guildId}:`, error);
      // Default to enabled on error to prevent breaking functionality
      return true;
    }
  }

  /**
   * Enable or disable a feature for a guild
   */
  async setFeatureEnabled(guildId: string, feature: FeatureName, enabled: boolean): Promise<void> {
    try {
      const settings: any = await dbManager.getGuildSettings(guildId);
      let enabledFeatures = settings.enabledFeatures || [];

      if (enabled && !enabledFeatures.includes(feature)) {
        enabledFeatures.push(feature);
      } else if (!enabled && enabledFeatures.includes(feature)) {
        enabledFeatures = enabledFeatures.filter((f: string) => f !== feature);
      }

      await dbManager.updateGuildSettings(guildId, enabledFeatures, settings.settings);

      // Update cache
      this.setCachedFeatures(guildId, enabledFeatures);

      console.log(`Feature ${feature} ${enabled ? 'enabled' : 'disabled'} for guild ${guildId}`);
    } catch (error) {
      console.error(`Error setting feature ${feature} for guild ${guildId}:`, error);
      throw error;
    }
  }

  /**
   * Get all enabled features for a guild
   */
  async getEnabledFeatures(guildId: string): Promise<FeatureName[]> {
    try {
      const cached = this.getCachedFeatures(guildId);
      if (cached) {
        return cached as FeatureName[];
      }

      const settings: any = await dbManager.getGuildSettings(guildId);
      const enabledFeatures = settings.enabledFeatures || [];

      this.setCachedFeatures(guildId, enabledFeatures);

      return enabledFeatures as FeatureName[];
    } catch (error) {
      console.error(`Error getting enabled features for guild ${guildId}:`, error);
      // Return default features on error
      return ['tickets', 'autoresponses', 'statistics', 'webhooks'];
    }
  }

  /**
   * Update multiple features at once
   */
  async updateFeatures(guildId: string, features: Partial<Record<FeatureName, boolean>>): Promise<void> {
    try {
      const currentFeatures = await this.getEnabledFeatures(guildId);
      let newFeatures = [...currentFeatures];

      for (const [feature, enabled] of Object.entries(features)) {
        const featureName = feature as FeatureName;
        if (enabled && !newFeatures.includes(featureName)) {
          newFeatures.push(featureName);
        } else if (!enabled && newFeatures.includes(featureName)) {
          newFeatures = newFeatures.filter(f => f !== featureName);
        }
      }

      const settings: any = await dbManager.getGuildSettings(guildId);
      await dbManager.updateGuildSettings(guildId, newFeatures, settings.settings);

      // Update cache
      this.setCachedFeatures(guildId, newFeatures);

      console.log(`Updated features for guild ${guildId}:`, newFeatures);
    } catch (error) {
      console.error(`Error updating features for guild ${guildId}:`, error);
      throw error;
    }
  }

  /**
   * Clear cache for a specific guild (useful when settings change)
   */
  clearCache(guildId: string): void {
    this.featureCache.delete(guildId);
    this.cacheExpiry.delete(guildId);
  }

  /**
   * Clear all cache
   */
  clearAllCache(): void {
    this.featureCache.clear();
    this.cacheExpiry.clear();
  }

  private getCachedFeatures(guildId: string): string[] | null {
    const expiry = this.cacheExpiry.get(guildId);
    if (!expiry || Date.now() > expiry) {
      this.featureCache.delete(guildId);
      this.cacheExpiry.delete(guildId);
      return null;
    }
    return this.featureCache.get(guildId) || null;
  }

  private setCachedFeatures(guildId: string, features: string[]): void {
    this.featureCache.set(guildId, features);
    this.cacheExpiry.set(guildId, Date.now() + this.CACHE_DURATION);
  }
}

// Export singleton instance
export const featureManager = FeatureManager.getInstance();
