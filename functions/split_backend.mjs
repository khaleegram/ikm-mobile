import { Project } from 'ts-morph';
import fs from 'fs';

const groups = {
  payments: ['initializePaystackTransaction', 'verifyPaystackTransaction', 'paystackWebhook', 'verifyPaymentAndCreateOrder', 'findRecentTransactionByEmail', 'savePayoutDetails', 'requestPayout', 'cancelPayoutRequest', 'getAllPayouts', 'calculateSellerEarnings', 'getSellerTransactions', 'getBanksList', 'resolveAccountNumber'],
  orders: ['updateOrderStatus', 'markOrderAsSent', 'markOrderAsReceived', 'getOrdersByCustomer', 'getOrdersBySeller', 'getAllOrders', 'resolveDispute', 'markOrderAsNotAvailable', 'respondToAvailabilityCheck'],
  products: ['searchProducts', 'getProduct', 'createProduct', 'updateProduct', 'deleteProduct', 'getSellerProducts', 'createNorthernProduct', 'updateNorthernProduct'],
  market: ['createMarketPost', 'likeMarketPost', 'deleteMarketPost', 'incrementPostViews', 'createMarketComment', 'deleteMarketComment', 'extractMarketSoundFromMarketVideo', 'createMarketChat', 'sendMarketMessage', 'sendOrderMessage'],
  users: ['linkGuestOrdersToAccount', 'getCustomers', 'getAllUsers', 'grantAdminRole', 'revokeAdminRole'],
  settings: ['calculateShippingOptions', 'getDashboardStats', 'getSellerAnalytics', 'generateSalesReport', 'generateCustomerReport', 'createDiscountCode', 'getDiscountCodes', 'updateDiscountCode', 'deleteDiscountCode', 'getStoreSettings', 'updateStoreSettings', 'getPlatformSettings', 'updatePlatformSettings', 'getPublicShippingZones', 'getShippingZones', 'createShippingZone', 'updateShippingZone', 'deleteShippingZone', 'getShippingSettings', 'updateShippingSettings', 'getAllParks', 'getParksByState', 'createPark', 'updatePark', 'deletePark', 'initializeParks', 'getAccessLogs', 'getFailedLogins', 'getApiKeys', 'createApiKey', 'revokeApiKey', 'getSecuritySettings', 'updateSecuritySettings', 'getAuditTrail', 'getFirestoreRules', 'helloWorld']
};

const project = new Project();
const sourceContent = fs.readFileSync('src/index.ts.backup', 'utf8');

for (const [groupName, exportsToKeep] of Object.entries(groups)) {
    const file = project.createSourceFile(`src/${groupName}.ts`, sourceContent, { overwrite: true });
    
    // Remove exported statements that are not in exportsToKeep
    for (const stmt of file.getStatements()) {
        let isExported = false;
        let name = '';
        
        if (stmt.getKindName() === 'VariableStatement') {
            if (stmt.hasModifier('export')) {
                isExported = true;
                name = stmt.getDeclarations()[0].getName();
            }
        } else if (stmt.getKindName() === 'FunctionDeclaration') {
            if (stmt.hasModifier('export')) {
                isExported = true;
                name = stmt.getName();
            }
        }
        
        if (isExported && !exportsToKeep.includes(name)) {
            stmt.remove();
        }
    }
    
    file.fixUnusedIdentifiers();
    file.saveSync();
    console.log(`Created src/${groupName}.ts`);
}

const indexContent = Object.keys(groups).map(g => `export * from './${g}';`).join('\n') + '\n';
fs.writeFileSync('src/index.ts', indexContent);
console.log('Updated src/index.ts');
