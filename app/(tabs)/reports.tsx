// Reports screen
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useTheme } from '@/lib/theme/theme-context';
import { useState, useMemo } from 'react';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { premiumShadow } from '@/lib/theme/styles';
import { useUser } from '@/lib/firebase/auth/use-user';
import { useSellerOrders } from '@/lib/firebase/firestore/orders';
import { useSellerProducts } from '@/lib/firebase/firestore/products';
import { useSellerCustomers } from '@/lib/firebase/firestore/customers';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

export default function ReportsScreen() {
  const { colors } = useTheme();
  const { user } = useUser();
  const { orders } = useSellerOrders(user?.uid || null);
  const { products } = useSellerProducts(user?.uid || null);
  const { customers } = useSellerCustomers(user?.uid || null);
  const [exporting, setExporting] = useState(false);
  const styles = createStyles(colors);

  // Calculate report data
  const reportData = useMemo(() => {
    const totalRevenue = orders
      .filter(o => o.status !== 'Cancelled' && o.status !== 'Disputed')
      .reduce((sum, order) => sum + (order.total || 0), 0);

    const completedOrders = orders.filter(o => o.status === 'Completed' || o.status === 'Received');
    const completedRevenue = completedOrders.reduce((sum, order) => sum + (order.total || 0), 0);

    const activeProducts = products.filter(p => p.status === 'active').length;
    const totalProducts = products.length;

    const vipCustomers = customers.filter(c => c.segment === 'VIP').length;

    return {
      totalRevenue,
      completedRevenue,
      totalOrders: orders.length,
      completedOrders: completedOrders.length,
      activeProducts,
      totalProducts,
      totalCustomers: customers.length,
      vipCustomers,
    };
  }, [orders, products, customers]);

  const generateSalesReport = () => {
    const salesReport = {
      period: new Date().toISOString(),
      summary: {
        totalRevenue: reportData.totalRevenue,
        completedRevenue: reportData.completedRevenue,
        totalOrders: reportData.totalOrders,
        completedOrders: reportData.completedOrders,
        averageOrderValue: reportData.totalOrders > 0 ? reportData.totalRevenue / reportData.totalOrders : 0,
      },
      orders: orders.map(order => ({
        id: order.id,
        date: order.createdAt instanceof Date ? order.createdAt.toISOString() : (order.createdAt as any)?.toISOString?.() || '',
        customerName: order.customerInfo?.name || '',
        total: order.total || 0,
        status: order.status,
        items: order.items?.length || 0,
      })),
    };

    return salesReport;
  };

  const generateCustomerReport = () => {
    const customerReport = {
      period: new Date().toISOString(),
      summary: {
        totalCustomers: reportData.totalCustomers,
        vipCustomers: reportData.vipCustomers,
        regularCustomers: customers.filter(c => c.segment === 'Regular').length,
        newCustomers: customers.filter(c => c.segment === 'New').length,
        averageOrderValue: reportData.totalCustomers > 0
          ? customers.reduce((sum, c) => sum + c.totalSpent, 0) / reportData.totalCustomers
          : 0,
      },
      customers: customers.map(customer => ({
        name: customer.name,
        email: customer.email,
        phone: customer.phone || '',
        totalSpent: customer.totalSpent,
        orderCount: customer.orderCount,
        segment: customer.segment,
        lastOrderDate: customer.lastOrderDate?.toISOString() || '',
        firstOrderDate: customer.firstOrderDate?.toISOString() || '',
      })),
    };

    return customerReport;
  };

  const generateProductReport = () => {
    const productReport = {
      period: new Date().toISOString(),
      summary: {
        totalProducts: reportData.totalProducts,
        activeProducts: reportData.activeProducts,
        inactiveProducts: products.filter(p => p.status === 'inactive').length,
        draftProducts: products.filter(p => p.status === 'draft').length,
      },
      products: products.map(product => ({
        id: product.id,
        name: product.name,
        price: product.price,
        stock: product.stock,
        status: product.status,
        salesCount: product.salesCount || 0,
        views: product.views || 0,
        averageRating: product.averageRating || 0,
        reviewCount: product.reviewCount || 0,
      })),
    };

    return productReport;
  };

  const exportReport = async (reportType: 'sales' | 'customer' | 'product') => {
    setExporting(true);
    try {
      let report: any;
      let fileName = '';

      if (reportType === 'sales') {
        report = generateSalesReport();
        fileName = `sales-report-${Date.now()}.json`;
      } else if (reportType === 'customer') {
        report = generateCustomerReport();
        fileName = `customer-report-${Date.now()}.json`;
      } else {
        report = generateProductReport();
        fileName = `product-report-${Date.now()}.json`;
      }

      const fileUri = FileSystem.documentDirectory + fileName;
      await FileSystem.writeAsStringAsync(fileUri, JSON.stringify(report, null, 2));

      try {
        // Dynamically import sharing to avoid build-time errors
        const Sharing = await import('expo-sharing');
        
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri);
          Alert.alert('Success', 'Report exported successfully');
        } else {
          // Fallback: Show success message
          Alert.alert('Report Generated', `Report saved to: ${fileName}\n\nSharing is not available on this device.`, [
            { text: 'OK' }
          ]);
        }
      } catch (shareError: any) {
        // Fallback if sharing fails or module not available
        console.log('Sharing error:', shareError);
        Alert.alert('Report Generated', `Report saved to: ${fileName}\n\nThe report has been saved to your device.`, [
          { text: 'OK' }
        ]);
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to export report');
    } finally {
      setExporting(false);
    }
  };

  const reportCards = [
    {
      title: 'Sales Report',
      description: 'Revenue, orders, and sales data',
      icon: 'dollarsign.circle.fill' as const,
      color: colors.success,
      data: [
        { label: 'Total Revenue', value: `₦${reportData.totalRevenue.toLocaleString()}` },
        { label: 'Completed Revenue', value: `₦${reportData.completedRevenue.toLocaleString()}` },
        { label: 'Total Orders', value: reportData.totalOrders.toString() },
        { label: 'Completed Orders', value: reportData.completedOrders.toString() },
      ],
      onExport: () => exportReport('sales'),
    },
    {
      title: 'Customer Report',
      description: 'Customer segments and spending',
      icon: 'person.2.fill' as const,
      color: colors.primary,
      data: [
        { label: 'Total Customers', value: reportData.totalCustomers.toString() },
        { label: 'VIP Customers', value: reportData.vipCustomers.toString() },
        { label: 'Regular Customers', value: customers.filter(c => c.segment === 'Regular').length.toString() },
        { label: 'New Customers', value: customers.filter(c => c.segment === 'New').length.toString() },
      ],
      onExport: () => exportReport('customer'),
    },
    {
      title: 'Product Report',
      description: 'Product performance and inventory',
      icon: 'cube.box.fill' as const,
      color: colors.warning,
      data: [
        { label: 'Total Products', value: reportData.totalProducts.toString() },
        { label: 'Active Products', value: reportData.activeProducts.toString() },
        { label: 'Inactive Products', value: products.filter(p => p.status === 'inactive').length.toString() },
        { label: 'Draft Products', value: products.filter(p => p.status === 'draft').length.toString() },
      ],
      onExport: () => exportReport('product'),
    },
  ];

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <Text style={[styles.title, { color: colors.text }]}>Reports</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Generate and export business reports
        </Text>
      </View>

      <View style={styles.content}>
        {reportCards.map((report, index) => (
          <View key={index} style={[styles.reportCard, { backgroundColor: colors.card }]}>
            <View style={styles.reportHeader}>
              <View style={[styles.reportIcon, { backgroundColor: `${report.color}20` }]}>
                <IconSymbol name={report.icon} size={32} color={report.color} />
              </View>
              <View style={styles.reportInfo}>
                <Text style={[styles.reportTitle, { color: colors.text }]}>{report.title}</Text>
                <Text style={[styles.reportDescription, { color: colors.textSecondary }]}>
                  {report.description}
                </Text>
              </View>
            </View>

            <View style={styles.reportData}>
              {report.data.map((item, idx) => (
                <View key={idx} style={styles.dataRow}>
                  <Text style={[styles.dataLabel, { color: colors.textSecondary }]}>{item.label}</Text>
                  <Text style={[styles.dataValue, { color: colors.text }]}>{item.value}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.exportButton, { backgroundColor: report.color, opacity: exporting ? 0.6 : 1 }]}
              onPress={report.onExport}
              disabled={exporting}>
              {exporting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <IconSymbol name="arrow.down" size={20} color="#fff" />
                  <Text style={styles.exportButtonText}>Export as JSON</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof import('@/lib/theme/colors').getColors>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      paddingTop: 60,
      paddingBottom: 24,
      paddingHorizontal: 20,
      ...premiumShadow,
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 14,
    },
    content: {
      padding: 20,
    },
    reportCard: {
      padding: 20,
      borderRadius: 16,
      marginBottom: 20,
      ...premiumShadow,
    },
    reportHeader: {
      flexDirection: 'row',
      marginBottom: 20,
    },
    reportIcon: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 16,
    },
    reportInfo: {
      flex: 1,
      justifyContent: 'center',
    },
    reportTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 4,
    },
    reportDescription: {
      fontSize: 14,
    },
    reportData: {
      marginBottom: 20,
    },
    dataRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    dataLabel: {
      fontSize: 14,
    },
    dataValue: {
      fontSize: 14,
      fontWeight: '600',
    },
    exportButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      borderRadius: 12,
      gap: 8,
    },
    exportButtonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
  });

