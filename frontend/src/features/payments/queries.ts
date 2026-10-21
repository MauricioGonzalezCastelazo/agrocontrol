import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { useBase } from '../../app/useBase'
import { request, type Page, type Order } from '../../lib/business-api'
import type { Payment, CustomerAccount } from './domain'

export async function allPages<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const items: T[] = []
  let page: Page<T>
  do {
    page = await request<Page<T>>(
      `${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${items.length}`,
      { signal },
    )
    items.push(...page.items)
  } while (page.items.length && items.length < page.total)
  return items
}
export function usePayment(id?: string) {
  const { principal } = useAuth(),
    preview = Boolean(useBase())
  return useQuery({
    queryKey: ['payment', principal?.organization_id, principal?.user_id, id],
    queryFn: () => request<Payment>(`/payments/${id}`, { cache: 'reload' }),
    enabled: !preview && Boolean(id),
    refetchOnWindowFocus: false,
  })
}
export function useCustomerOrders(id?: string) {
  const { principal } = useAuth(),
    preview = Boolean(useBase())
  return useQuery({
    queryKey: ['orders', principal?.organization_id, principal?.user_id, 'account', id],
    queryFn: ({ signal }) => allPages<Order>(`/orders?customer_id=${id}`, signal),
    enabled: !preview && Boolean(id),
  })
}
export function useAccount(id?: string) {
  const { principal } = useAuth(),
    preview = Boolean(useBase())
  return useQuery({
    queryKey: ['accounts', principal?.organization_id, principal?.user_id, id],
    queryFn: async () =>
      (await request<Page<CustomerAccount>>(`/customer-accounts?customer_id=${id}`)).items[0],
    enabled: !preview && Boolean(id),
  })
}
export function useInvalidatePayments() {
  const cache = useQueryClient()
  return () =>
    Promise.all(
      [
        'accounts',
        'account-picker',
        'orders',
        'order',
        'payment',
        'payments',
        'pending-payments',
      ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
    )
}
