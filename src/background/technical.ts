/**
 * Firefox asks at install whether to share technical data (browser and window size), and it
 * may be declined. Chrome has no such permission and rejects the question, so it counts as yes.
 */
export async function technicalDataAllowed(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ data_collection: ['technicalAndInteraction'] } as chrome.permissions.Permissions);
  } catch {
    return true;
  }
}
