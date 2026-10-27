import { addressNetwork, limitSubject } from './rate-limits';

describe('the rate-limit subject of the forms routes', () => {
  it('counts an IPv6 client by its /64 and an IPv4 client by its address', () => {
    expect(addressNetwork('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
    expect(addressNetwork('2001:DB8:1:2:bbbb:cccc:dddd:eeee')).toBe('2001:db8:1:2::/64');
    expect(addressNetwork('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(addressNetwork('::1')).toBe('0:0:0:0::/64');
    expect(addressNetwork('64:ff9b::192.0.2.1')).toBe('64:ff9b:0:0::/64');
    expect(addressNetwork('::ffff:198.51.100.7')).toBe('198.51.100.7');
    expect(addressNetwork('198.51.100.7')).toBe('198.51.100.7');
    expect(addressNetwork('unknown')).toBe('unknown');
  });

  it('counts a signed-in person by account, wherever they are', () => {
    const anonymous = { kind: 'anonymous' };
    const staff = { kind: 'authenticated', accountId: 'a-1' };
    expect(limitSubject(anonymous, '2001:db8:1:2::9')).toBe('address:2001:db8:1:2::/64');
    expect(limitSubject(staff, '198.51.100.7')).toBe('account:a-1');
  });
});
