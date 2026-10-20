/** The signed-in customer's account. */
export class CustomerAccountResponse {
  customerId!: string;
  /** The verified phone (E.164) the account was registered with. One account per phone. */
  phone!: string;
  /** ACTIVE, SUSPENDED or DELETED. Only ACTIVE customers can book and pay. */
  status!: string;
  createdAt!: string;
}
