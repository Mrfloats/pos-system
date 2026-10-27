/// A receipt printer couldn't be reached or refused the job. [message] is for the cashier.
class PrinterException implements Exception {
  const PrinterException(this.message);

  final String message;

  @override
  String toString() => message;
}
