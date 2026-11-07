import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Linking, Alert, TextInput } from 'react-native';
import { openSupportContact } from '../src/services/supportContact';
import HelpScreen from '../src/screens/support/HelpScreen';
import SupportChatScreen from '../src/screens/support/SupportChatScreen';
Object.defineProperty(require('react-native'),'Linking',{configurable:true,value:{openURL:jest.fn()}});
beforeEach(()=>{jest.clearAllMocks();(Linking.openURL as jest.Mock).mockResolvedValue(undefined);});
it('opens the supplied support dialer/email composer and preserves the selected trip reference',async()=>{
 await openSupportContact('call'); expect(Linking.openURL).toHaveBeenCalledWith('tel:+918949667612');
 await openSupportContact('email','MR-A'); const uri=(Linking.openURL as jest.Mock).mock.calls[1][0];
 expect(uri).toMatch(/^mailto:ranjeetbaghme2000@gmail.com\?/);expect(decodeURIComponent(uri)).toContain('Trip reference: MR-A');
});
it('shows contact details if no dialer/email app can open',async()=>{
 const alert=jest.spyOn(Alert,'alert');(Linking.openURL as jest.Mock).mockRejectedValueOnce(new Error('no mail client'));
 await openSupportContact('email');expect(alert).toHaveBeenCalledWith('Could not open an email app',expect.stringContaining('ranjeetbaghme2000@gmail.com'));alert.mockRestore();
});
it('opens support preview with trip context and keeps it read-only without an admin connection',async()=>{
 const navigate=jest.fn();let view:any;
 await act(async()=>{view=TestRenderer.create(<HelpScreen navigation={{navigate}} route={{params:{tripReference:'MR-A'}}}/>);});
 act(()=>view.root.findByProps({accessibilityLabel:'Preview support chat'}).props.onPress());
 expect(navigate).toHaveBeenCalledWith('SupportChatScreen',{tripReference:'MR-A'});act(()=>view.unmount());
 await act(async()=>{view=TestRenderer.create(<SupportChatScreen route={{params:{tripReference:'MR-A'}}}/>);});
 expect(view.root.findByType(TextInput).props.editable).toBe(false);
 expect(Linking.openURL).not.toHaveBeenCalled();act(()=>view.unmount());
});
